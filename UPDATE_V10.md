# Demo v10 — Telegram Assistants (~25 min)

The bots are live: **BOL approval, PTI screening, accident alerts** — running in your
truck groups, with every action landing in the right department's feed inside the TMS.

## What the bot does

**In each truck group** (group title = truck number, bound with `/link 4114`):

- **📄 BOL** — driver sends the bill of lading photo with caption "bol". The bot reads
  freight, weight, pieces, temperature, delivery address, appointment and special
  instructions, **cross-checks against the load** (flags a different delivery city or a
  weight gap over 500 lbs), then posts the summary tagging dispatch with **✅ Yes / ✖️ No**
  buttons. Only someone connected to a dispatch record can press them. Yes → the BOL is
  attached to the load, temperature/weight updated, load marked in progress, and the
  message is edited to show who approved it.
- **🛞 PTI** — photos with caption "pti" are screened for visible DOT problems (tires,
  lights, windshield, leaks, air lines, mudflaps, securement, body damage). Clean → logged
  quietly. Flagged → findings with confidence, tagging safety, maintenance and dispatch.
  It always says "possible / verify" — it screens, it doesn't certify.
- **🚨 Accidents** — every message is screened. Plain words (accident, crash, rollover,
  udes, sudar, авария…) fire **instantly**; softer phrasing ("guy slammed his brakes and I
  clipped him") goes to an AI check. On a hit: an alert tagging dispatch, safety,
  maintenance, fleet and tracking, with the truck's last known ELD position attached, plus
  an incident record in the TMS.
- **Commands** — `/link 4114`, `/register`, `/help`.

**In the TMS**: Admin → **Telegram setup** shows connected groups (with truck linking),
registered people (connect each to a driver or staff record — required for tagging), and
anything currently **waiting for a dispatcher** in Telegram. Every action also appears in
the department feeds and on the Assistants page.

**Not yet connected: the broker email chain.** On approval the bot attaches the BOL and
marks the load loaded, and says so in the group — sending the "we are loaded" reply-all
needs your dispatch mailbox connected, which is the next build.

## Setup

**1. Code**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Telegram assistants"
git push
```

(extract the zip over the folder first; no `npm install` needed)

**2. Create the bot** — in Telegram, message **@BotFather**:
- `/newbot` → name it (e.g. "Roadmark TMS") → username must end in `bot`
  (e.g. `RoadmarkTMSBot`) → **copy the token**
- `/setprivacy` → pick your bot → **Disable** ← *essential*, otherwise the bot only sees
  commands, not BOL photos or accident messages.

**3. Add secrets** — Supabase → Edge Functions → Secrets:
- `TELEGRAM_BOT_TOKEN` = the token from BotFather
- (`ANTHROPIC_API_KEY` is already there from v2)

**4. Deploy the function — with JWT verification OFF** (Telegram can't send a login token):

```powershell
npx supabase functions deploy telegram-webhook --no-verify-jwt
```

Browser alternative: Edge Functions → Deploy a new function → name `telegram-webhook` →
paste `supabase/functions/telegram-webhook/index.ts` → **untick "Verify JWT"** → Deploy.

**5. Point Telegram at it** — one command, replacing both placeholders:

```powershell
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_PROJECT_REF.functions.supabase.co/telegram-webhook"
```

Expect `{"ok":true,...}`. Check any time with
`curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"`.

**6. Connect a group**
- Create (or open) a Telegram group titled with the truck number, e.g. **4114**
- Add your bot to it
- Send `/link 4114` → the bot confirms
- Everyone sends `/register` once → then in the TMS, Admin → **Telegram setup**, connect
  each person to their driver or staff record. *Tagging only works for people with a
  Telegram @username set.*

## Try it (5 minutes, safe)

1. In the group, send `/help` → the bot answers.
2. Send a photo of any bill of lading with caption **bol** → summary + Yes/No appears.
   Press **Yes** from an account connected to a dispatch employee → the message updates,
   and the BOL shows on the load's Documents in the TMS.
3. Send a truck photo with caption **pti** → screening result.
4. Type **"test drill — we had an accident"** → instant alert tagging every department.
   Then open Safety → the incident is in the feed; close it as a false alarm from
   Assistants.

## Troubleshooting
- **Bot silent in the group** → privacy mode still enabled (step 2), or the webhook isn't
  set (`getWebhookInfo` shows `last_error_message`).
- **"401 Unauthorized" in getWebhookInfo** → the function was deployed *with* JWT
  verification; redeploy with `--no-verify-jwt`.
- **Buttons say "Only the dispatcher can approve"** → that Telegram user isn't connected
  to a dispatch employee (or admin) in Admin → Telegram setup.
- **Nobody gets tagged** → people need a Telegram @username, and must be connected to a
  record.
- Function logs: Supabase → Edge Functions → telegram-webhook → Logs.
