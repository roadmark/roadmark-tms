// email-send — send a reply-all into a broker's existing conversation
// Deploy as: email-send   Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//
// Body: { load_id, kind: 'loaded_notice'|'tracking_update'|'delivered_notice'|'custom',
//         custom_text?, attach_document_id? }
//
// Threading is what puts the message *inside* the broker's conversation: we send with
// the same Gmail threadId plus In-Reply-To / References headers, addressed to everyone
// already on the thread minus ourselves. That is literally what Reply-All does.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function accessToken(admin: any, mailbox_id: string) {
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
  if (!res.ok) throw new Error(`Google token refresh: ${t.error_description || t.error}`);
  await admin.from('email_credentials').update({
    access_token: t.access_token,
    access_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
  }).eq('mailbox_id', mailbox_id);
  return t.access_token as string;
}

const b64url = (bytes: Uint8Array) =>
  encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Fill {placeholders} from a context object. */
export function fill(tpl: string, ctx: Record<string, unknown>) {
  return (tpl || '').replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? '').trim() || '—');
}

export async function sendReplyAll(admin: any, opts: {
  company_id: string; thread: any; mailbox: any; subject: string; body: string;
  attachment?: { filename: string; mime: string; bytes: Uint8Array } | null;
}) {
  const token = await accessToken(admin, opts.mailbox.id);
  const parts = (opts.thread.participants ?? []) as { email: string; role?: string }[];
  const mine = String(opts.mailbox.address).toLowerCase();
  const to = [...new Set(parts.filter((p) => p.role !== 'cc').map((p) => p.email))].filter((e) => e !== mine);
  const cc = [...new Set(parts.filter((p) => p.role === 'cc').map((p) => p.email))]
    .filter((e) => e !== mine && !to.includes(e));
  if (!to.length && !cc.length) throw new Error('No recipients found on that conversation');

  const subject = opts.subject.toLowerCase().startsWith('re:') ? opts.subject : `Re: ${opts.subject}`;
  const boundary = `rm_${crypto.randomUUID().replace(/-/g, '')}`;
  const head = [
    `From: ${opts.mailbox.display_name || opts.mailbox.address} <${opts.mailbox.address}>`,
    `To: ${to.join(', ')}`,
    cc.length ? `Cc: ${cc.join(', ')}` : '',
    `Subject: ${subject}`,
    opts.thread.last_message_rfc_id ? `In-Reply-To: ${opts.thread.last_message_rfc_id}` : '',
    opts.thread.references_chain ? `References: ${opts.thread.references_chain}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  let raw: string;
  if (opts.attachment) {
    head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    raw = head.join('\r\n') + '\r\n\r\n' +
      `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${opts.body}\r\n\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.attachment.mime}; name="${opts.attachment.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${opts.attachment.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      encodeBase64(opts.attachment.bytes).replace(/(.{76})/g, '$1\r\n') +
      `\r\n--${boundary}--`;
  } else {
    head.push('Content-Type: text/plain; charset="UTF-8"');
    raw = head.join('\r\n') + '\r\n\r\n' + opts.body;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      raw: b64url(new TextEncoder().encode(raw)),
      threadId: opts.thread.provider_thread_id,
    }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Gmail send: ${out.error?.message || res.status}`);
  return { to, cc, id: out.id };
}

/** Everything the templates can reference for one load. */
export async function loadContext(admin: any, load_id: string) {
  const { data: load } = await admin.from('loads')
    .select(`*, customer:customers(name), truck:trucks(id, unit_number),
             driver:drivers!loads_driver_id_fkey(full_name)`)
    .eq('id', load_id).maybeSingle();
  if (!load) throw new Error('Load not found');
  const { data: company } = await admin.from('companies').select('name').eq('id', load.company_id).maybeSingle();

  let location = '', eta = '';
  if (load.truck?.id) {
    const { data: pos } = await admin.from('unit_locations')
      .select('lat, lng, address_text, located_at, speed_mph')
      .eq('truck_id', load.truck.id).order('located_at', { ascending: false }).limit(1).maybeSingle();
    if (pos) {
      location = pos.address_text || `${Number(pos.lat).toFixed(3)}, ${Number(pos.lng).toFixed(3)}`;
      // crude but honest ETA: straight-line miles at 55 mph, only when we know the stop
      eta = load.delivery_time ? new Date(load.delivery_time).toLocaleString('en-US') : '';
    }
  }
  return {
    load, company,
    ctx: {
      load_number: load.load_number,
      customer_load_id: load.customer_load_id || `#${load.load_number}`,
      customer: load.customer?.name || '',
      truck: load.truck?.unit_number || '',
      driver_first_name: (load.driver?.full_name || '').split(' ')[0] || '',
      location, eta,
      next_stop_city: load.delivery_location || '',
      appointment_time: load.delivery_time ? new Date(load.delivery_time).toLocaleString('en-US') : '',
      temperature: load.temperature || '',
      company: company?.name || '',
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { load_id, kind = 'tracking_update', custom_text, attach_document_id } = await req.json();
    if (!load_id) return json({ error: 'load_id is required' }, 400);

    const { load, ctx } = await loadContext(admin, load_id);

    const { data: thread } = await admin.from('email_threads')
      .select('*').eq('load_id', load_id).order('last_message_at', { ascending: false })
      .limit(1).maybeSingle();
    if (!thread) return json({ error: 'This load has no broker conversation linked yet' }, 400);

    const { data: mailbox } = await admin.from('email_mailboxes')
      .select('*').eq('id', thread.mailbox_id).maybeSingle();
    if (!mailbox) return json({ error: 'Mailbox not found' }, 400);

    const { data: tpl } = await admin.from('message_templates')
      .select('*').eq('company_id', load.company_id).eq('kind', kind)
      .order('created_at').limit(1).maybeSingle();

    const subject = thread.subject || fill(tpl?.subject || 'Update — {customer_load_id}', ctx);
    const bodyText = custom_text || fill(tpl?.body || 'Update for {customer_load_id}: near {location}. ETA {eta}.', ctx);

    let attachment = null;
    if (attach_document_id) {
      const { data: doc } = await admin.from('documents')
        .select('file_name, file_path, mime_type').eq('id', attach_document_id).maybeSingle();
      if (doc) {
        const { data: file } = await admin.storage.from('company-docs').download(doc.file_path);
        if (file) attachment = {
          filename: doc.file_name, mime: doc.mime_type || 'application/octet-stream',
          bytes: new Uint8Array(await file.arrayBuffer()),
        };
      }
    }

    const sent = await sendReplyAll(admin, {
      company_id: load.company_id, thread, mailbox, subject, body: bodyText, attachment,
    });

    await admin.from('assistant_actions').insert({
      company_id: load.company_id,
      kind: kind === 'loaded_notice' ? 'bol_loaded_notice' : kind === 'tracking_update' ? 'tracking_update' : 'custom_email',
      status: 'sent', load_id, truck_id: load.truck_id, driver_id: load.driver_id,
      email_thread_id: thread.id, departments: ['dispatch', 'tracking'],
      summary: `${kind === 'loaded_notice' ? 'Loaded notice' : 'Tracking update'} sent to ${sent.to[0]}${sent.to.length + sent.cc.length > 1 ? ` +${sent.to.length + sent.cc.length - 1}` : ''} — ${ctx.customer_load_id}`,
      payload: { to: sent.to, cc: sent.cc, subject }, sent_at: new Date().toISOString(),
    });

    // an update to the broker is also a check call
    await admin.from('check_calls').insert({
      load_id, company_id: load.company_id, location_text: ctx.location || null,
      note: `Broker update sent (${kind})`, source: 'eld',
    });

    return json({ ok: true, to: sent.to, cc: sent.cc });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
