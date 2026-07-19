// tracking-updates — hourly broker location updates, sent as reply-all into the
// existing conversation. Driven by tracking_subscriptions.
// Deploy as: tracking-updates   Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Schedule every 5 minutes; it only sends the ones actually due.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function accessToken(admin: any, mailbox_id: string) {
  const { data: c } = await admin.from('email_credentials').select('*').eq('mailbox_id', mailbox_id).maybeSingle();
  if (!c) throw new Error('Mailbox is not connected');
  if (c.access_token && c.access_expires_at && new Date(c.access_expires_at) > new Date()) return c.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: c.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const t = await res.json();
  if (!res.ok) throw new Error(`token refresh: ${t.error_description || t.error}`);
  await admin.from('email_credentials').update({
    access_token: t.access_token,
    access_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
  }).eq('mailbox_id', mailbox_id);
  return t.access_token as string;
}

const b64url = (b: Uint8Array) =>
  encodeBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fill = (tpl: string, ctx: Record<string, unknown>) =>
  (tpl || '').replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? '').trim() || '—');

const R = 3958.8;
const miles = (a: number, b: number, c: number, d: number) => {
  const rad = (x: number) => x * Math.PI / 180;
  const dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

Deno.serve(async (req) => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();

    const { data: subs } = await admin.from('tracking_subscriptions')
      .select('*').eq('enabled', true).is('stopped_at', null)
      .or(`next_send_at.is.null,next_send_at.lte.${now.toISOString()}`).limit(50);
    if (!subs?.length) return json({ ok: true, due: 0 });

    const report: unknown[] = [];
    for (const sub of subs) {
      try {
        const { data: load } = await admin.from('loads')
          .select(`*, customer:customers(name), truck:trucks(id, unit_number),
                   driver:drivers!loads_driver_id_fkey(full_name)`)
          .eq('id', sub.load_id).maybeSingle();
        if (!load) { await admin.from('tracking_subscriptions').update({ stopped_at: now.toISOString(), stop_reason: 'load missing' }).eq('id', sub.id); continue; }

        // stop by itself once the load is done
        if (!['in_progress', 'scheduled'].includes(load.status)) {
          await admin.from('tracking_subscriptions')
            .update({ stopped_at: now.toISOString(), stop_reason: `load ${load.status}` }).eq('id', sub.id);
          report.push({ load: load.load_number, action: `stopped (${load.status})` });
          continue;
        }

        // quiet hours
        if (sub.quiet_start && sub.quiet_end) {
          const hhmm = now.toISOString().slice(11, 16);
          const inQuiet = sub.quiet_start < sub.quiet_end
            ? (hhmm >= sub.quiet_start && hhmm < sub.quiet_end)
            : (hhmm >= sub.quiet_start || hhmm < sub.quiet_end);
          if (inQuiet) {
            await admin.from('tracking_subscriptions').update({
              next_send_at: new Date(now.getTime() + 30 * 60000).toISOString(),
            }).eq('id', sub.id);
            continue;
          }
        }

        const { data: pos } = load.truck?.id ? await admin.from('unit_locations')
          .select('lat, lng, address_text, located_at')
          .eq('truck_id', load.truck.id).order('located_at', { ascending: false })
          .limit(1).maybeSingle() : { data: null };

        // no fresh position — tell dispatch instead of emailing the broker stale data
        const fresh = pos && (now.getTime() - new Date(pos.located_at).getTime()) < 90 * 60000;
        if (!fresh) {
          await admin.from('assistant_actions').insert({
            company_id: load.company_id, kind: 'tracking_update', status: 'failed',
            load_id: load.id, truck_id: load.truck_id, departments: ['dispatch', 'tracking'],
            summary: `Update skipped for #${load.load_number} — no ELD position in the last 90 minutes`,
            sent_at: now.toISOString(),
          });
          await admin.from('tracking_subscriptions').update({
            next_send_at: new Date(now.getTime() + sub.interval_minutes * 60000).toISOString(),
          }).eq('id', sub.id);
          report.push({ load: load.load_number, action: 'skipped — stale position' });
          continue;
        }

        const { data: thread } = await admin.from('email_threads')
          .select('*').eq('id', sub.email_thread_id).maybeSingle();
        if (!thread) throw new Error('no linked conversation');
        const { data: mailbox } = await admin.from('email_mailboxes')
          .select('*').eq('id', thread.mailbox_id).maybeSingle();
        if (!mailbox) throw new Error('mailbox missing');

        // distance + rough ETA to the last delivery stop, when we have coordinates
        let etaText = load.delivery_time ? new Date(load.delivery_time).toLocaleString('en-US') : '';
        let milesLeft = '';
        const { data: stop } = await admin.from('load_stops')
          .select('city, state, scheduled_at').eq('load_id', load.id).eq('stop_type', 'delivery')
          .order('seq', { ascending: false }).limit(1).maybeSingle();
        if (pos?.lat && load.delivery_lat && load.delivery_lng) {
          const m = miles(pos.lat, pos.lng, load.delivery_lat, load.delivery_lng);
          milesLeft = `${Math.round(m)}`;
          etaText = new Date(now.getTime() + (m / 52) * 3600 * 1000).toLocaleString('en-US');
        }

        const ctx = {
          load_number: load.load_number,
          customer_load_id: load.customer_load_id || `#${load.load_number}`,
          truck: load.truck?.unit_number || '',
          driver_first_name: (load.driver?.full_name || '').split(' ')[0] || '',
          location: pos?.address_text || `${Number(pos.lat).toFixed(3)}, ${Number(pos.lng).toFixed(3)}`,
          miles_left: milesLeft,
          next_stop_city: stop ? [stop.city, stop.state].filter(Boolean).join(', ') : (load.delivery_location || ''),
          eta: etaText,
          appointment_time: load.delivery_time ? new Date(load.delivery_time).toLocaleString('en-US') : '',
          company: '',
        };
        const { data: company } = await admin.from('companies').select('name').eq('id', load.company_id).maybeSingle();
        ctx.company = company?.name || '';

        const { data: tpl } = await admin.from('message_templates')
          .select('*').eq('company_id', load.company_id).eq('kind', 'tracking_update')
          .order('created_at').limit(1).maybeSingle();
        const bodyText = fill(tpl?.body ||
          'Location update for {customer_load_id}: truck {truck} is near {location}. Next stop {next_stop_city}, ETA {eta}.', ctx);
        const subject = thread.subject?.toLowerCase().startsWith('re:')
          ? thread.subject : `Re: ${thread.subject || fill('Update — {customer_load_id}', ctx)}`;

        const token = await accessToken(admin, mailbox.id);
        const parts = (thread.participants ?? []) as { email: string; role?: string }[];
        const mine = String(mailbox.address).toLowerCase();
        const extra = (sub.extra_recipients ?? []) as string[];
        const to = [...new Set([...parts.filter((p) => p.role !== 'cc').map((p) => p.email), ...extra])]
          .filter((e) => e !== mine);
        const cc = [...new Set(parts.filter((p) => p.role === 'cc').map((p) => p.email))]
          .filter((e) => e !== mine && !to.includes(e));
        if (!to.length && !cc.length) throw new Error('no recipients on the conversation');

        const raw = [
          `From: ${mailbox.display_name || mailbox.address} <${mailbox.address}>`,
          `To: ${to.join(', ')}`,
          cc.length ? `Cc: ${cc.join(', ')}` : '',
          `Subject: ${subject}`,
          thread.last_message_rfc_id ? `In-Reply-To: ${thread.last_message_rfc_id}` : '',
          thread.references_chain ? `References: ${thread.references_chain}` : '',
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset="UTF-8"',
        ].filter(Boolean).join('\r\n') + '\r\n\r\n' + bodyText;

        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raw: b64url(new TextEncoder().encode(raw)),
            threadId: thread.provider_thread_id,
          }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(`Gmail send: ${out.error?.message || res.status}`);

        await admin.from('tracking_subscriptions').update({
          last_sent_at: now.toISOString(),
          next_send_at: new Date(now.getTime() + sub.interval_minutes * 60000).toISOString(),
          started_at: sub.started_at ?? now.toISOString(),
        }).eq('id', sub.id);

        await admin.from('assistant_actions').insert({
          company_id: load.company_id, kind: 'tracking_update', status: 'sent',
          load_id: load.id, truck_id: load.truck_id, driver_id: load.driver_id,
          email_thread_id: thread.id, departments: ['dispatch', 'tracking'],
          summary: `Update sent to ${to[0]}${to.length + cc.length > 1 ? ` +${to.length + cc.length - 1}` : ''} — ${ctx.customer_load_id} near ${ctx.location}`,
          payload: { to, cc }, sent_at: now.toISOString(),
        });
        await admin.from('check_calls').insert({
          load_id: load.id, company_id: load.company_id,
          lat: pos.lat, lng: pos.lng, location_text: ctx.location,
          note: 'Automatic broker update', source: 'eld',
        });

        report.push({ load: load.load_number, action: 'sent', to: to.length + cc.length });
      } catch (e) {
        await admin.from('tracking_subscriptions').update({
          next_send_at: new Date(now.getTime() + 30 * 60000).toISOString(),
        }).eq('id', sub.id);
        report.push({ subscription: sub.id, error: String(e).slice(0, 200) });
      }
    }
    return json({ ok: true, processed: report.length, report });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
