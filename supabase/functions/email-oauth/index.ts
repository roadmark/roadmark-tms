// email-oauth — exchange the Google consent code for a refresh token and store it
// Deploy as: email-oauth
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//
// The refresh token is written to email_credentials, a table with RLS enabled and no
// policies — only edge functions (service role) can ever read it.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set' }, 500);
    }

    const { code, redirect_uri, company_id } = await req.json();
    if (!code || !redirect_uri || !company_id) return json({ error: 'code, redirect_uri and company_id are required' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: u } = await anon.auth.getUser();
    if (!u?.user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: member } = await admin.from('company_members')
      .select('role').eq('company_id', company_id).eq('user_id', u.user.id)
      .eq('status', 'active').maybeSingle();
    if (!member || !['master_admin', 'general_manager'].includes(member.role)) {
      return json({ error: 'Only an admin can connect a mailbox' }, 403);
    }

    // exchange the one-time code for tokens
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri, grant_type: 'authorization_code',
      }),
    });
    const tok = await tokRes.json();
    if (!tokRes.ok) return json({ error: `Google: ${tok.error_description || tok.error || tokRes.status}` }, 400);
    if (!tok.refresh_token) {
      return json({ error: 'Google did not return a refresh token. Disconnect the app at myaccount.google.com/permissions and connect again.' }, 400);
    }

    // which mailbox is this?
    const prof = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })).json();
    const address = prof.emailAddress;
    if (!address) return json({ error: 'Could not read the mailbox address from Google' }, 400);

    const { data: mailbox, error: mErr } = await admin.from('email_mailboxes').upsert({
      company_id, provider: 'gmail', address, display_name: address,
      secret_ref: 'db', status: 'active', connected_at: new Date().toISOString(),
      last_error: null, created_by: u.user.id,
    }, { onConflict: 'company_id,address' }).select('id').single();
    if (mErr) throw mErr;

    const { error: cErr } = await admin.from('email_credentials').upsert({
      mailbox_id: mailbox.id, company_id,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token ?? null,
      access_expires_at: tok.expires_in
        ? new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString() : null,
      scope: tok.scope ?? null, updated_at: new Date().toISOString(),
    });
    if (cErr) throw cErr;

    return json({ ok: true, address });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
