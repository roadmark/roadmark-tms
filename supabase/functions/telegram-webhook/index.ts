// telegram-webhook — Roadmark TMS driver-group assistant
// Deploy as function name: telegram-webhook  with JWT VERIFICATION OFF
//   CLI:     npx supabase functions deploy telegram-webhook --no-verify-jwt
//   Browser: untick "Verify JWT" when deploying
// Secrets: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, (optional) TELEGRAM_WEBHOOK_SECRET
//
// Handles: /link, /register, /help · BOL photos · PTI photos · accident detection
// Everything it does is written to assistant_actions / pti_inspections /
// incident_reports, which is what the department feeds in the TMS read.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const TG = (m: string) => `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/${m}`;
const ok = () => new Response('ok');

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/* ------------------------- telegram helpers ------------------------- */
async function send(chat_id: number, text: string, reply_markup?: unknown) {
  const r = await fetch(TG('sendMessage'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup }),
  });
  return await r.json();
}
async function editText(chat_id: number, message_id: number, text: string) {
  await fetch(TG('editMessageText'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'HTML' }),
  });
}
async function answerCb(id: string, text: string) {
  await fetch(TG('answerCallbackQuery'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}
async function fetchTelegramFile(file_id: string) {
  const meta = await (await fetch(TG(`getFile?file_id=${file_id}`))).json();
  const path = meta?.result?.file_path;
  if (!path) throw new Error('Could not read the file from Telegram');
  const url = `https://api.telegram.org/file/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/${path}`;
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, name: path.split('/').pop() || 'file' };
}

/* --------------------------- claude helper -------------------------- */
async function claude(body: unknown) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content ?? []).filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text).join('\n');
}
const parseJson = (t: string) => JSON.parse(t.replace(/```json|```/g, '').trim());

/* ------------------------ accident detection ------------------------ */
// instant layer — plain words that mean trouble, several languages
const HARD = /\b(accident|accidente|crash|crashed|wreck|wrecked|rollover|rolled over|collision|collided|rear.?end|t.?boned|jack.?knif|udes|sudar|nesre[cć]a|prevrn|авари|дтп|столкн)\b/i;
// second layer — worth an AI read
const SOFT = /\b(hit|hit me|slid|slide|ditch|guardrail|tow|towed|police|cop|ambulance|injur|hurt|damage|damaged|broke|smash|scratch|bump|fender|deer|ice|skid|stuck|blew|blowout)\b/i;

async function classifyIncident(text: string) {
  try {
    const out = await claude({
      model: 'claude-sonnet-4-6', max_tokens: 200, temperature: 0,
      messages: [{
        role: 'user',
        content: `A truck driver sent this message to the dispatch group. Decide if it reports a
vehicle accident, collision, or crash (any language). Respond ONLY as JSON:
{"is_accident": true|false, "severity": "minor"|"major"|"injury"|"unknown", "reason": "short"}

Message: """${text.slice(0, 800)}"""`,
      }],
    });
    return parseJson(out);
  } catch { return { is_accident: false }; }
}

/* ------------------------------ context ----------------------------- */
async function groupContext(db: ReturnType<typeof admin>, chat_id: number) {
  const { data: g } = await db.from('telegram_groups')
    .select('*').eq('chat_id', chat_id).maybeSingle();
  if (!g?.truck_id) return { group: g, truck: null, driver: null, load: null };

  const { data: truck } = await db.from('trucks')
    .select('id, unit_number, company_id').eq('id', g.truck_id).maybeSingle();
  const { data: asg } = await db.from('assignments')
    .select('driver_id, driver:drivers(id, full_name)')
    .eq('truck_id', g.truck_id).is('ended_at', null).maybeSingle();
  const { data: load } = await db.from('loads')
    .select('id, load_number, status, customer_load_id, delivery_location, delivery_time, customer:customers(name)')
    .eq('truck_id', g.truck_id).in('status', ['scheduled', 'in_progress'])
    .order('pickup_time', { ascending: false }).limit(1).maybeSingle();
  return { group: g, truck, driver: asg?.driver ?? null, load: load ?? null };
}

async function lastPosition(db: ReturnType<typeof admin>, truck_id: string) {
  const { data } = await db.from('unit_locations')
    .select('lat, lng, address_text, located_at').eq('truck_id', truck_id)
    .order('located_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

/** Everyone to tag for a set of departments (mapped Telegram users only). */
async function mentions(db: ReturnType<typeof admin>, company_id: string, depts: string[]) {
  const { data: ids } = await db.from('telegram_identities')
    .select('username, display_name, employee_id, profile_id, driver_id')
    .eq('company_id', company_id);
  if (!ids?.length) return '';
  const { data: emps } = await db.from('employees')
    .select('id, department').eq('company_id', company_id);
  const { data: mems } = await db.from('company_members')
    .select('user_id, role, department').eq('company_id', company_id).eq('status', 'active');
  const empDept = Object.fromEntries((emps ?? []).map((e) => [e.id, e.department]));
  const memDept = Object.fromEntries((mems ?? []).map((m) => [m.user_id, m]));

  const names: string[] = [];
  for (const i of ids) {
    let hit = false;
    if (i.employee_id && depts.includes(empDept[i.employee_id])) hit = true;
    if (i.profile_id) {
      const m = memDept[i.profile_id];
      if (m && (['master_admin', 'general_manager'].includes(m.role) || depts.includes(m.department))) hit = true;
    }
    if (hit && i.username) names.push(`@${i.username}`);
  }
  return [...new Set(names)].join(' ');
}

async function logAction(db: ReturnType<typeof admin>, row: Record<string, unknown>) {
  const { data } = await db.from('assistant_actions').insert(row).select('id').single();
  return data?.id;
}

/* ------------------------------- main ------------------------------- */
Deno.serve(async (req) => {
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (secret && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let update: any;
  try { update = await req.json(); } catch { return ok(); }
  const db = admin();

  try {
    /* ---------- button presses (BOL approval) ---------- */
    if (update.callback_query) {
      const cb = update.callback_query;
      const [verb, actionId] = String(cb.data || '').split(':');
      const chat_id = cb.message?.chat?.id;

      const { data: action } = await db.from('assistant_actions')
        .select('*').eq('id', actionId).maybeSingle();
      if (!action) { await answerCb(cb.id, 'This request has expired.'); return ok(); }
      if (action.status !== 'awaiting_approval') {
        await answerCb(cb.id, 'Already handled.'); return ok();
      }

      // only dispatch (or an admin) may decide
      const { data: who } = await db.from('telegram_identities')
        .select('employee_id, profile_id, display_name')
        .eq('company_id', action.company_id).eq('telegram_user_id', cb.from.id).maybeSingle();
      let allowed = false;
      if (who?.employee_id) {
        const { data: e } = await db.from('employees').select('department').eq('id', who.employee_id).maybeSingle();
        allowed = e?.department === 'dispatch';
      }
      if (!allowed && who?.profile_id) {
        const { data: m } = await db.from('company_members').select('role, department')
          .eq('company_id', action.company_id).eq('user_id', who.profile_id).maybeSingle();
        allowed = !!m && (['master_admin', 'general_manager'].includes(m.role) || m.department === 'dispatch');
      }
      if (!allowed) {
        await answerCb(cb.id, 'Only the dispatcher can approve this.');
        return ok();
      }

      if (verb === 'no') {
        await db.from('assistant_actions').update({
          status: 'rejected', decided_at: new Date().toISOString(),
        }).eq('id', actionId);
        await answerCb(cb.id, 'Cancelled — nothing sent.');
        await editText(chat_id, cb.message.message_id,
          `${cb.message.text}\n\n❌ Cancelled by ${who?.display_name || 'dispatcher'} — nothing was sent.`);
        return ok();
      }

      // YES — attach the BOL to the load and mark it loaded
      const payload = action.payload || {};
      if (action.load_id) {
        await db.from('documents').insert({
          company_id: action.company_id, entity_type: 'load', entity_id: action.load_id,
          doc_type: 'bol', file_name: payload.file_name || 'bol.jpg',
          file_path: payload.file_path, extraction_job_id: action.extraction_job_id,
        });
        const patch: Record<string, unknown> = { status: 'in_progress' };
        if (payload.temperature) patch.temperature = String(payload.temperature);
        if (payload.weight_lbs) patch.weight_lbs = Number(payload.weight_lbs);
        await db.from('loads').update(patch).eq('id', action.load_id);
      }
      await db.from('assistant_actions').update({
        status: 'sent', decided_at: new Date().toISOString(), sent_at: new Date().toISOString(),
        summary: `BOL approved — attached to load #${payload.load_number ?? '?'} and marked loaded`,
      }).eq('id', actionId);

      await answerCb(cb.id, 'Approved');
      await editText(chat_id, cb.message.message_id,
        `${cb.message.text}\n\n✅ Approved by ${who?.display_name || 'dispatcher'}. BOL attached to the load and the load marked loaded.\n<i>Broker email chain not connected yet — send the notice from your mailbox for now.</i>`);
      return ok();
    }

    /* ---------- ordinary messages ---------- */
    const msg = update.message ?? update.edited_message ?? update.channel_post;
    if (!msg) return ok();
    const chat_id = msg.chat.id;
    const text: string = msg.text || msg.caption || '';
    const ctx = await groupContext(db, chat_id);

    // --- /link 4114 : bind this group to a truck ---
    if (/^\/link\b/i.test(text)) {
      const unit = text.split(/\s+/)[1];
      if (!unit) { await send(chat_id, 'Use: <code>/link 4114</code> (the truck number).'); return ok(); }
      const { data: truck } = await db.from('trucks')
        .select('id, unit_number, company_id').eq('unit_number', unit).limit(1).maybeSingle();
      if (!truck) { await send(chat_id, `No truck <b>${unit}</b> found in the TMS.`); return ok(); }
      await db.from('telegram_groups').upsert({
        chat_id, company_id: truck.company_id, title: msg.chat.title || unit,
        truck_id: truck.id, active: true, updated_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });
      await send(chat_id, `✅ Linked to truck <b>${truck.unit_number}</b>. Send the BOL after loading, PTI photos in the morning, and tell us straight away if anything happens on the road.`);
      return ok();
    }

    // --- /register : map this Telegram user to a person ---
    if (/^\/register\b/i.test(text)) {
      if (!ctx.group?.company_id) { await send(chat_id, 'Link this group to a truck first: <code>/link 4114</code>'); return ok(); }
      await db.from('telegram_identities').upsert({
        company_id: ctx.group.company_id, telegram_user_id: msg.from.id,
        username: msg.from.username ?? null,
        display_name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      }, { onConflict: 'company_id,telegram_user_id' });
      await send(chat_id, `👋 Registered <b>${msg.from.first_name || 'you'}</b>. Someone in the office will connect you to your driver or staff record in Admin → Assistants.`);
      return ok();
    }

    if (/^\/help\b/i.test(text) || /^\/start\b/i.test(text)) {
      await send(chat_id,
        '<b>Roadmark TMS assistant</b>\n' +
        '• <code>/link 4114</code> — connect this group to a truck\n' +
        '• <code>/register</code> — introduce yourself to the system\n' +
        '• Send the <b>BOL</b> photo after loading (caption "bol")\n' +
        '• Send <b>PTI</b> photos with caption "pti"\n' +
        '• If anything happens on the road, just write it — the office is alerted instantly');
      return ok();
    }

    if (!ctx.group?.company_id) return ok();       // unlinked group: stay quiet
    const company_id = ctx.group.company_id;

    /* ---------- accident detection (runs on every text) ---------- */
    if (text && text.length > 3) {
      let fire = HARD.test(text);
      let severity = 'unknown';
      if (!fire && SOFT.test(text) && text.length > 20) {
        const c = await classifyIncident(text);
        fire = !!c.is_accident;
        severity = c.severity || 'unknown';
      }
      if (fire) {
        const pos = ctx.truck ? await lastPosition(db, ctx.truck.id) : null;
        const { data: inc } = await db.from('incident_reports').insert({
          company_id, source: 'telegram', telegram_chat_id: chat_id,
          telegram_message_id: msg.message_id, reported_text: text.slice(0, 2000),
          driver_id: ctx.driver?.id ?? null, truck_id: ctx.truck?.id ?? null,
          load_id: ctx.load?.id ?? null, lat: pos?.lat ?? null, lng: pos?.lng ?? null,
          severity, status: 'open',
        }).select('id').single();

        const tags = await mentions(db, company_id, ['dispatch', 'safety', 'maintenance', 'fleet', 'tracking']);
        await send(chat_id,
          `🚨 <b>POSSIBLE ACCIDENT</b> — truck ${ctx.truck?.unit_number ?? '?'}` +
          (ctx.driver ? `, driver ${ctx.driver.full_name}` : '') + '\n' +
          (pos ? `Last position: ${pos.address_text || `${pos.lat}, ${pos.lng}`}\n` : '') +
          `\n<b>Are you safe? Is anyone injured?</b>\n` +
          `Dispatch, safety, maintenance, fleet and tracking have been alerted.` +
          (tags ? `\n${tags}` : ''));

        await logAction(db, {
          company_id, kind: 'incident_alert', status: 'sent',
          load_id: ctx.load?.id ?? null, truck_id: ctx.truck?.id ?? null,
          driver_id: ctx.driver?.id ?? null, telegram_chat_id: chat_id,
          departments: ['safety', 'dispatch', 'maintenance', 'fleet', 'tracking'],
          summary: `Accident alert from truck ${ctx.truck?.unit_number ?? '?'} — all departments tagged`,
          payload: { incident_id: inc?.id, text: text.slice(0, 300) },
          sent_at: new Date().toISOString(),
        });
        return ok();
      }
    }

    /* ---------- photos / documents ---------- */
    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
    const doc = msg.document;
    if (!photo && !doc) return ok();

    const wantsPti = /\bpti\b|pre.?trip|inspection/i.test(text);
    const wantsBol = /\bbol\b|bill of lading|loaded/i.test(text);
    if (!wantsPti && !wantsBol) {
      // ask once rather than guess
      await send(chat_id, 'Got the photo 📷 — is it the <b>BOL</b> or the <b>PTI</b>? Reply with the word, or add it as the caption next time.');
      return ok();
    }

    const file_id = photo?.file_id || doc?.file_id;
    const { bytes, name } = await fetchTelegramFile(file_id);
    const ext = (doc?.file_name?.split('.').pop() || name.split('.').pop() || 'jpg').toLowerCase();
    const mediaType = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png' : 'image/jpeg';
    const entity = wantsPti ? 'truck' : 'load';
    const entityId = wantsPti ? (ctx.truck?.id ?? 'intake') : (ctx.load?.id ?? 'intake');
    const path = `${company_id}/${entity}/${entityId}/${crypto.randomUUID()}_${name}`;
    await db.storage.from('company-docs').upload(path, bytes, { contentType: mediaType });
    const b64 = encodeBase64(bytes);
    const fileBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };

    /* ---------- PTI screening ---------- */
    if (wantsPti) {
      const { data: insp } = await db.from('pti_inspections').insert({
        company_id, truck_id: ctx.truck?.id ?? null, driver_id: ctx.driver?.id ?? null,
        telegram_chat_id: chat_id, image_paths: [path], result: 'pending',
      }).select('id').single();

      let analysis: any = null;
      try {
        analysis = parseJson(await claude({
          model: 'claude-sonnet-4-6', max_tokens: 1000, temperature: 0,
          messages: [{ role: 'user', content: [fileBlock, { type: 'text', text:
`Screen this pre-trip inspection photo of a commercial truck/trailer for VISIBLE DOT
problems only: tire condition (flat, visibly bald, cord showing, sidewall damage),
lights and lens damage, windshield cracks in the wiper path, mirrors, visible fluid
leaks, damaged air lines, missing mudflaps, insecure load, body damage.

Report only what is clearly visible. Do NOT guess tread depth or brake condition.
Respond ONLY as JSON:
{"violations":[{"code":"tire_tread|light_lens|windshield|leak|airline|mudflap|securement|body|other",
"label":"short description","severity":"out_of_service|violation|warn","confidence":0.0}],
"notes":"one sentence"}` }] }],
        }));
      } catch (_) { /* fall through to failed */ }

      const violations = analysis?.violations ?? [];
      const result = !analysis ? 'failed_analysis' : violations.length ? 'flagged' : 'pass';
      await db.from('pti_inspections').update({
        analysis, violations, result,
        departments: ['safety', 'maintenance'],
      }).eq('id', insp?.id);

      if (result === 'pass') {
        await send(chat_id, `🛞 PTI received for truck ${ctx.truck?.unit_number ?? '?'} — <b>no visible issues</b>. Logged for safety. Drive safe.`);
      } else if (result === 'flagged') {
        const tags = await mentions(db, company_id, ['safety', 'maintenance', 'dispatch']);
        const list = violations.map((v: any) =>
          `• ${v.label} <i>(${v.severity}, confidence ${Math.round((v.confidence ?? 0) * 100)}%)</i>`).join('\n');
        await send(chat_id,
          `🛞⚠️ <b>PTI — possible issues</b> on truck ${ctx.truck?.unit_number ?? '?'}\n${list}\n\n` +
          `Please verify before rolling. Safety and maintenance have been notified.` +
          (tags ? `\n${tags}` : ''));
      } else {
        await send(chat_id, `🛞 PTI photo saved for truck ${ctx.truck?.unit_number ?? '?'}, but automatic screening failed. Safety will review it by hand.`);
      }

      await logAction(db, {
        company_id, kind: 'pti_alert', status: 'sent',
        truck_id: ctx.truck?.id ?? null, driver_id: ctx.driver?.id ?? null,
        telegram_chat_id: chat_id, departments: ['safety', 'maintenance'],
        summary: result === 'flagged'
          ? `PTI flagged on truck ${ctx.truck?.unit_number ?? '?'} — ${violations.length} possible issue(s)`
          : result === 'pass' ? `PTI clear on truck ${ctx.truck?.unit_number ?? '?'}`
          : `PTI screening failed on truck ${ctx.truck?.unit_number ?? '?'}`,
        payload: { pti_id: insp?.id, path }, sent_at: new Date().toISOString(),
      });
      return ok();
    }

    /* ---------- BOL ---------- */
    const { data: job } = await db.from('extraction_jobs').insert({
      company_id, kind: 'bol', status: 'processing', file_path: path, file_name: name,
    }).select('id').single();

    let bol: any = null;
    try {
      bol = parseJson(await claude({
        model: 'claude-sonnet-4-6', max_tokens: 1500, temperature: 0,
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text:
`Read this Bill of Lading. Respond ONLY as JSON:
{"shipper":"","consignee":"","delivery_address":"","commodity":"","weight_lbs":null,
"piece_count":"","temperature":"","appointment":"","special_instructions":"","bol_number":""}` }] }],
      }));
      await db.from('extraction_jobs').update({ status: 'needs_review', extracted: bol }).eq('id', job?.id);
    } catch (e) {
      await db.from('extraction_jobs').update({ status: 'failed', error: String(e).slice(0, 300) }).eq('id', job?.id);
    }

    if (!bol) {
      await send(chat_id, '📄 BOL saved, but I could not read it automatically. Dispatch will handle it by hand.');
      return ok();
    }

    // compare against the rate confirmation data we already hold
    const flags: string[] = [];
    if (ctx.load) {
      if (bol.weight_lbs && ctx.load.weight_lbs && Math.abs(Number(bol.weight_lbs) - Number(ctx.load.weight_lbs)) > 500) {
        flags.push(`weight differs (BOL ${bol.weight_lbs} vs load ${ctx.load.weight_lbs})`);
      }
      if (bol.delivery_address && ctx.load.delivery_location) {
        const a = String(bol.delivery_address).toLowerCase();
        const b = String(ctx.load.delivery_location).toLowerCase().split(',')[0].trim();
        if (b && !a.includes(b)) flags.push(`delivery city differs (BOL "${bol.delivery_address}" vs load "${ctx.load.delivery_location}")`);
      }
    }

    const actionId = await logAction(db, {
      company_id, kind: 'bol_loaded_notice', status: 'awaiting_approval',
      load_id: ctx.load?.id ?? null, truck_id: ctx.truck?.id ?? null,
      driver_id: ctx.driver?.id ?? null, telegram_chat_id: chat_id,
      extraction_job_id: job?.id, departments: ['dispatch'],
      summary: `BOL received on truck ${ctx.truck?.unit_number ?? '?'} — awaiting dispatcher approval`,
      payload: { ...bol, file_path: path, file_name: name, load_number: ctx.load?.load_number },
    });

    const tags = await mentions(db, company_id, ['dispatch']);
    const lines = [
      `📄 <b>BOL received</b> — truck ${ctx.truck?.unit_number ?? '?'}` +
        (ctx.load ? ` · load #${ctx.load.load_number}${ctx.load.customer?.name ? ` (${ctx.load.customer.name})` : ''}` : ' · no active load found'),
      bol.commodity ? `Freight: ${bol.commodity}${bol.weight_lbs ? `, ${bol.weight_lbs} lbs` : ''}${bol.piece_count ? `, ${bol.piece_count}` : ''}` : '',
      bol.temperature ? `Temperature: ${bol.temperature}` : '',
      bol.delivery_address ? `Deliver: ${bol.delivery_address}` : '',
      bol.appointment ? `Appointment: ${bol.appointment}` : '',
      bol.special_instructions ? `Instructions: ${bol.special_instructions}` : '',
      flags.length ? `\n⚠️ ${flags.join('; ')}` : '',
      `\nDispatcher — attach this BOL and mark the load loaded?` + (tags ? ` ${tags}` : ''),
    ].filter(Boolean);

    await send(chat_id, lines.join('\n'), {
      inline_keyboard: [[
        { text: '✅ Yes', callback_data: `yes:${actionId}` },
        { text: '✖️ No', callback_data: `no:${actionId}` },
      ]],
    });
    return ok();
  } catch (e) {
    console.error('telegram-webhook error', e);
    return ok();   // always 200 so Telegram doesn't retry forever
  }
});
