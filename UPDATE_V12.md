# Demo v12 — Broker Email Chain (the last piece)

The assistant can now **reply straight into the broker's own email conversation** — the
loaded notice with the BOL attached, and location updates every 60 minutes until delivery.

## How the "reply-all into the chain" actually works

Email conversations hold together through two hidden headers: every message has a
**Message-ID**, and replies carry **In-Reply-To** and **References** pointing back at it.
So to land inside a broker's thread you must (a) *be* a mailbox already on it and (b) send
with those headers set.

That's exactly what this does. You connect your real dispatch mailbox once. The app then
mirrors the **envelope** of recent conversations — subject, who's on the thread, and those
message IDs. **It never stores email bodies.** When the assistant replies, it sends from
your mailbox, with the IDs attached, addressed to everyone already on the thread minus
itself. The broker and their tracking department see it in the same conversation, exactly
as if your dispatcher had hit Reply All.

## What's new in the app

**Admin → Broker email** — connect the mailbox with Google sign-in, sync conversations,
and edit the message templates (placeholders like `{customer_load_id}`, `{truck}`,
`{location}`, `{eta}`, `{next_stop_city}`).

**Every load drawer → "Broker conversation"**
- Link the broker's email thread (auto-linked already when the subject or text contains
  the load's reference number), or pick from recent unlinked conversations.
- **Send loaded notice** / **Send location update** — one click, reply-all.
- **Automatic updates: On/Off** with an interval (30/60/120/240 min). Once on, the truck's
  position goes into that conversation on schedule until the load is delivered, then stops
  by itself. If the ELD has been silent over 90 minutes it alerts dispatch instead of
  emailing the broker stale data. Every send is also recorded as a check call.

**Telegram BOL bot completes the loop** — pressing ✅ Yes now attaches the BOL, marks the
load loaded, **and sends the loaded notice with the BOL attached** into the broker chain,
then edits the group message to say who it went to.

## Setup

**1. Database** — Supabase → SQL Editor → run `supabase/migrations/013_email.sql`
(adds the credentials table and seeds two default templates).

**2. Code**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Broker email chain"
git push
```

**3. Google Cloud (once, ~15 min)**
1. console.cloud.google.com → create a project (or reuse one) → **APIs & Services**
2. **Enable APIs** → search **Gmail API** → Enable
3. **OAuth consent screen** → choose **Internal** if you use Google Workspace (no review
   needed); otherwise External + add yourself as a test user
4. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized redirect URIs — add **both**:
     - `https://roadmark-tms.vercel.app/admin/email`
     - `http://localhost:5173/admin/email`
   - Create → copy the **Client ID** and **Client secret**

**4. Keys in the right places**
- Vercel → Settings → Environment Variables → add
  `VITE_GOOGLE_CLIENT_ID` = your client ID → **Redeploy**
  (also add it to `.env.local` for local testing)
- Supabase → Edge Functions → Secrets → add
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

The client **secret** never goes near the app — only the edge functions see it.

**5. Deploy the four functions**

```powershell
npx supabase functions deploy email-oauth
npx supabase functions deploy email-sync
npx supabase functions deploy email-send
npx supabase functions deploy tracking-updates
npx supabase functions deploy telegram-webhook --no-verify-jwt
```

(the last one is a redeploy — it now sends the loaded notice)

**6. Connect the mailbox** — in the app: Admin → **Broker email** → *Connect dispatch
mailbox* → sign in as `dispatch@yourcompany.com` → allow. You'll land back on the page
with "Connected". Click **Sync conversations**.

**7. Schedule the automatic updates** — SQL Editor, replacing both placeholders:

```sql
select cron.schedule('tracking-updates', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/tracking-updates',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb); $$);

select cron.schedule('email-sync', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/email-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb); $$);
```

It runs every 5 minutes but only sends the subscriptions actually due — that's how a
60-minute interval stays accurate.

## Try it safely

Email yourself from another address with a subject containing a load's reference (e.g.
`BR-20841 rate con`), CC a colleague. Then:
1. Admin → Broker email → **Sync conversations** → it appears, auto-linked to that load.
2. Open the load → **Broker conversation** shows the thread and who's on it.
3. **Send location update** → check your inbox: the reply is inside the same conversation,
   addressed to you and the colleague.
4. Turn **Automatic updates On** at 30 minutes and watch the next one arrive by itself.

Use a test broker address until you trust the wording. Templates are editable under
Admin → Broker email.

## Troubleshooting
- **"Google did not return a refresh token"** → revoke the app at
  myaccount.google.com/permissions and connect again (Google only issues it on first consent).
- **redirect_uri_mismatch** → the URI in Google Cloud must match exactly, including https
  and no trailing slash.
- **"This load has no broker conversation linked yet"** → link one in the load drawer.
- **"No recipients found"** → the mirrored thread only had your own address; sync again
  after a real reply arrives.
- **Nothing sends automatically** → check `select jobname from cron.job;` and the function
  logs under Edge Functions → tracking-updates.
