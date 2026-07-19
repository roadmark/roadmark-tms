// reminders-run — Roadmark TMS reminder engine
// Deploy as function name: reminders-run  (JWT verification can stay ON — cron sends the
// service role key). Secrets used: TELEGRAM_BOT_TOKEN (optional — without it, reminders
// are still created and shown in the TMS, just not posted to Telegram).
//
// Every run it:
//   1. generates reminders from compliance expiries (14 and 3 days out) and PM due
//   2. generates appointment reminders ~2 h before a load's pickup/delivery
//   3. sends everything now due to the right truck group, tagging the right departments
//   4. records each send in assistant_actions so it appears in the department feeds

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const BOT = Deno.env.get('TELEGRAM_BOT_TOKEN');

async function tgSend(chat_id: number, text: string) {
  if (!BOT) return false;
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return (await r.json())?.ok === true;
}

/** @usernames for the given departments (+ optionally the driver). */
async function mentionsFor(
  db: ReturnType<typeof createClient>, company_id: string, depts: string[], driver_id?: string | null,
) {
  const { data: ids } = await db.from('telegram_identities')
    .select('username, employee_id, profile_id, driver_id').eq('company_id', company_id);
  if (!ids?.length) return '';
  const { data: emps } = await db.from('employees').select('id, department').eq('company_id', company_id);
  const { data: mems } = await db.from('company_members')
    .select('user_id, role, department').eq('company_id', company_id).eq('status', 'active');
  const empDept = Object.fromEntries((emps ?? []).map((e) => [e.id, e.department]));
  const memBy = Object.fromEntries((mems ?? []).map((m) => [m.user_id, m]));

  const out: string[] = [];
  for (const i of ids) {
    if (!i.username) continue;
    let hit = false;
    if (driver_id && i.driver_id === driver_id) hit = true;
    if (!hit && i.employee_id && depts.includes(empDept[i.employee_id])) hit = true;
    if (!hit && i.profile_id) {
      const m = memBy[i.profile_id];
      if (m && (['master_admin', 'general_manager'].includes(m.role) || depts.includes(m.department))) hit = true;
    }
    if (hit) out.push(`@${i.username}`);
  }
  return [...new Set(out)].join(' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const today = new Date().toISOString().slice(0, 10);
    const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    let generated = 0, sent = 0;

    /* ---------- 1. compliance expiries ---------- */
    const { data: comp } = await db.from('compliance_items')
      .select(`id, company_id, entity_type, entity_id, expiry_date,
               type:compliance_types(code, name)`)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today).lte('expiry_date', inDays(14));

    for (const c of comp ?? []) {
      const days = Math.round((new Date(c.expiry_date).getTime() - Date.now()) / 86400000);
      if (![14, 3].includes(days)) continue;

      const { data: dupe } = await db.from('reminders').select('id')
        .eq('company_id', c.company_id).eq('entity_type', 'compliance_item')
        .eq('entity_id', c.id).gte('due_at', `${today}T00:00:00`).maybeSingle();
      if (dupe) continue;

      let driver_id: string | null = null, truck_id: string | null = null, who = '';
      if (c.entity_type === 'driver') {
        driver_id = c.entity_id;
        const { data: d } = await db.from('drivers').select('full_name').eq('id', c.entity_id).maybeSingle();
        who = d?.full_name ?? 'driver';
      } else if (c.entity_type === 'truck') {
        truck_id = c.entity_id;
        const { data: t } = await db.from('trucks').select('unit_number').eq('id', c.entity_id).maybeSingle();
        who = `truck ${t?.unit_number ?? ''}`;
      } else {
        const { data: t } = await db.from('trailers').select('unit_number').eq('id', c.entity_id).maybeSingle();
        who = `trailer ${t?.unit_number ?? ''}`;
      }

      await db.from('reminders').insert({
        company_id: c.company_id, kind: 'compliance',
        title: `${c.type?.code} expiring — ${who}`,
        body: `${c.type?.name} for ${who} expires on ${c.expiry_date} (${days} days).`,
        due_at: new Date().toISOString(),
        mention_departments: c.entity_type === 'driver' ? ['safety'] : ['safety', 'fleet'],
        mention_driver: c.entity_type === 'driver',
        entity_type: 'compliance_item', entity_id: c.id,
        driver_id, truck_id, status: 'scheduled',
        summary: `${c.type?.code} for ${who} expires ${c.expiry_date} (${days} days)`,
      });
      generated++;
    }

    /* ---------- 2. PM due by odometer ---------- */
    const { data: pms } = await db.from('pm_schedules')
      .select('id, company_id, truck_id, name, interval_miles, last_done_odometer')
      .not('truck_id', 'is', null).not('interval_miles', 'is', null);

    for (const pm of pms ?? []) {
      const { data: odo } = await db.from('odometer_readings')
        .select('reading').eq('truck_id', pm.truck_id)
        .order('recorded_at', { ascending: false }).limit(1).maybeSingle();
      if (!odo) continue;
      const due = Number(pm.last_done_odometer ?? 0) + Number(pm.interval_miles);
      if (Number(odo.reading) < due - 1000) continue;   // warn within 1,000 mi

      const { data: dupe } = await db.from('reminders').select('id')
        .eq('company_id', pm.company_id).eq('entity_type', 'pm_schedule')
        .eq('entity_id', pm.id).eq('status', 'scheduled').maybeSingle();
      if (dupe) continue;

      const { data: t } = await db.from('trucks').select('unit_number').eq('id', pm.truck_id).maybeSingle();
      await db.from('reminders').insert({
        company_id: pm.company_id, kind: 'pm_service',
        title: `${pm.name} due — truck ${t?.unit_number ?? ''}`,
        body: `Odometer ${Math.round(Number(odo.reading)).toLocaleString()} mi, due at ${due.toLocaleString()} mi.`,
        due_at: new Date().toISOString(),
        mention_departments: ['maintenance', 'fleet'], mention_driver: false,
        entity_type: 'pm_schedule', entity_id: pm.id, truck_id: pm.truck_id, status: 'scheduled',
        summary: `${pm.name} due on truck ${t?.unit_number ?? ''} at ${due.toLocaleString()} mi`,
      });
      generated++;
    }

    /* ---------- 3. appointment reminders (~2 h out) ---------- */
    const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const soonPlus = new Date(Date.now() + 2.25 * 3600 * 1000).toISOString();
    const { data: loads } = await db.from('loads')
      .select('id, company_id, load_number, driver_id, truck_id, status, pickup_time, delivery_time, pickup_location, delivery_location')
      .in('status', ['scheduled', 'in_progress']);

    for (const l of loads ?? []) {
      const checks: Array<['pickup' | 'delivery', string | null, string | null]> = [
        ['pickup', l.pickup_time, l.pickup_location],
        ['delivery', l.delivery_time, l.delivery_location],
      ];
      for (const [what, when, where] of checks) {
        if (!when || when < soon || when > soonPlus) continue;
        const { data: dupe } = await db.from('reminders').select('id')
          .eq('company_id', l.company_id).eq('entity_type', `load_${what}`)
          .eq('entity_id', l.id).maybeSingle();
        if (dupe) continue;
        await db.from('reminders').insert({
          company_id: l.company_id, kind: 'appointment',
          title: `${what === 'pickup' ? 'Pickup' : 'Delivery'} in 2 hours — load #${l.load_number}`,
          body: `${where ?? ''} at ${new Date(when).toLocaleString()}`,
          due_at: new Date().toISOString(),
          mention_departments: ['dispatch'], mention_driver: true,
          entity_type: `load_${what}`, entity_id: l.id,
          load_id: l.id, driver_id: l.driver_id, truck_id: l.truck_id, status: 'scheduled',
          summary: `${what} appointment in 2 h — load #${l.load_number} (${where ?? ''})`,
        });
        generated++;
      }
    }

    /* ---------- 4. send everything due ---------- */
    const { data: due } = await db.from('reminders')
      .select('*').eq('status', 'scheduled').lte('due_at', new Date().toISOString()).limit(100);

    for (const r of due ?? []) {
      let chat_id: number | null = r.telegram_chat_id;
      if (!chat_id && r.truck_id) {
        const { data: g } = await db.from('telegram_groups')
          .select('chat_id').eq('truck_id', r.truck_id).eq('active', true).maybeSingle();
        chat_id = g?.chat_id ?? null;
      }
      if (!chat_id && r.driver_id) {
        const { data: a } = await db.from('assignments')
          .select('truck_id').eq('driver_id', r.driver_id).is('ended_at', null).maybeSingle();
        if (a?.truck_id) {
          const { data: g } = await db.from('telegram_groups')
            .select('chat_id').eq('truck_id', a.truck_id).eq('active', true).maybeSingle();
          chat_id = g?.chat_id ?? null;
        }
      }

      const depts = Array.isArray(r.mention_departments) ? r.mention_departments : [];
      let posted = false;
      if (chat_id) {
        const tags = await mentionsFor(db, r.company_id, depts, r.mention_driver ? r.driver_id : null);
        posted = await tgSend(chat_id,
          `⏰ <b>${r.title}</b>` + (r.body ? `\n${r.body}` : '') + (tags ? `\n${tags}` : ''));
      }

      await db.from('reminders').update({
        status: 'sent', sent_at: new Date().toISOString(), telegram_chat_id: chat_id,
      }).eq('id', r.id);

      await db.from('assistant_actions').insert({
        company_id: r.company_id, kind: 'reminder', status: 'sent',
        load_id: r.load_id, truck_id: r.truck_id, driver_id: r.driver_id,
        telegram_chat_id: chat_id, departments: depts.length ? depts : ['dispatch'],
        summary: (r.summary || r.title) + (posted ? '' : ' — shown in the TMS only (no linked Telegram group)'),
        sent_at: new Date().toISOString(),
      });
      sent++;
    }

    return json({ ok: true, generated, sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
