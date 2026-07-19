// email-sync — mirror recent Gmail conversation metadata into email_threads and
// auto-link them to loads by broker reference. Stores envelope data only, never bodies.
// Deploy as: email-sync   Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Refresh the Google access token for a mailbox and cache it. */
async function accessToken(admin: any, mailbox_id: string) {
  const { data: c } = await admin.from('email_credentials')
    .select('*').eq('mailbox_id', mailbox_id).maybeSingle();
  if (!c) throw new Error('Mailbox is not connected');
  if (c.access_token && c.access_expires_at && new Date(c.access_expires_at) > new Date()) {
    return c.access_token as string;
  }
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
    updated_at: new Date().toISOString(),
  }).eq('mailbox_id', mailbox_id);
  return t.access_token as string;
}

const header = (h: any[], name: string) =>
  h?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

const addresses = (s: string) =>
  (s || '').split(',').map((p) => {
    const m = p.match(/<([^>]+)>/);
    const email = (m ? m[1] : p).trim().toLowerCase();
    const name = m ? p.slice(0, p.indexOf('<')).replace(/"/g, '').trim() : '';
    return email.includes('@') ? { email, name } : null;
  }).filter(Boolean) as { email: string; name: string }[];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { mailbox_id } = body as { mailbox_id?: string };

    let q = admin.from('email_mailboxes').select('*').eq('status', 'active');
    if (mailbox_id) q = admin.from('email_mailboxes').select('*').eq('id', mailbox_id);
    const { data: boxes } = await q;
    if (!boxes?.length) return json({ ok: true, message: 'No connected mailbox' });

    const report: unknown[] = [];
    for (const box of boxes) {
      try {
        const token = await accessToken(admin, box.id);

        // recent conversations only — envelope data, no bodies
        const list = await (await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=60&q=' +
          encodeURIComponent('newer_than:14d -in:chats'),
          { headers: { Authorization: `Bearer ${token}` } })).json();

        const threads = new Map<string, any>();
        for (const m of list.messages ?? []) {
          const msg = await (await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata` +
            '&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc' +
            '&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Date',
            { headers: { Authorization: `Bearer ${token}` } })).json();
          const h = msg.payload?.headers ?? [];
          const tid = msg.threadId;
          const ts = Number(msg.internalDate ?? 0);
          const prev = threads.get(tid);
          if (prev && prev.ts > ts) continue;
          threads.set(tid, {
            ts,
            subject: header(h, 'Subject'),
            snippet: msg.snippet ?? '',
            participants: [
              ...addresses(header(h, 'From')).map((a) => ({ ...a, role: 'to' })),
              ...addresses(header(h, 'To')).map((a) => ({ ...a, role: 'to' })),
              ...addresses(header(h, 'Cc')).map((a) => ({ ...a, role: 'cc' })),
            ].filter((a) => a.email !== String(box.address).toLowerCase()),
            message_id: header(h, 'Message-ID'),
            references: header(h, 'References'),
            date: header(h, 'Date'),
          });
        }

        // loads we might be able to link to
        const { data: loads } = await admin.from('loads')
          .select('id, load_number, customer_load_id')
          .eq('company_id', box.company_id)
          .in('status', ['scheduled', 'in_progress', 'delivered', 'invoiced']);

        let linked = 0;
        for (const [tid, t] of threads) {
          const dedup = new Map(t.participants.map((p: any) => [p.email, p]));
          const row: Record<string, unknown> = {
            company_id: box.company_id, mailbox_id: box.id, provider_thread_id: tid,
            subject: t.subject, snippet: t.snippet.slice(0, 300),
            participants: [...dedup.values()],
            last_message_rfc_id: t.message_id,
            references_chain: [t.references, t.message_id].filter(Boolean).join(' ').trim(),
            last_message_at: t.date ? new Date(t.date).toISOString() : new Date(t.ts).toISOString(),
            updated_at: new Date().toISOString(),
          };

          // auto-link by broker reference or #load number in the subject/snippet
          const hay = `${t.subject} ${t.snippet}`.toLowerCase();
          const hit = (loads ?? []).find((l) =>
            (l.customer_load_id && hay.includes(String(l.customer_load_id).toLowerCase())) ||
            hay.includes(`#${l.load_number}`));
          if (hit) { row.load_id = hit.id; row.auto_linked = true; linked++; }

          await admin.from('email_threads').upsert(row, { onConflict: 'mailbox_id,provider_thread_id' });
        }

        await admin.from('email_mailboxes')
          .update({ last_sync_at: new Date().toISOString(), last_error: null, status: 'active' })
          .eq('id', box.id);
        report.push({ mailbox: box.address, conversations: threads.size, auto_linked: linked });
      } catch (e) {
        await admin.from('email_mailboxes')
          .update({ status: 'error', last_error: String(e).slice(0, 400) }).eq('id', box.id);
        report.push({ mailbox: box.address, error: String(e).slice(0, 300) });
      }
    }
    return json({ ok: true, report });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
