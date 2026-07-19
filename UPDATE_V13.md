# Demo v13 — Production Hardening + Handoff

No new screens. This makes the Telegram bots safe to run on a real fleet, and adds the
handoff document.

## What changed

**1. The webhook answers Telegram instantly.**
Previously the bot did its AI work *before* replying to Telegram. A PTI analysis takes
20+ seconds, and Telegram retries an update it thinks was lost — which at scale means
duplicate BOL prompts in the group. Now it acknowledges immediately and does the work in
the background.

**2. Duplicate updates are ignored.**
Every Telegram update id is recorded once (`telegram_updates`). A retried delivery is
dropped rather than processed twice. The table self-prunes after two days.

**3. PTI photos are analysed as one batch.**
A driver's walk-around is 6–8 photos, which Telegram delivers as separate updates. The
first one creates the inspection and waits a few seconds for its siblings; the rest attach
themselves. **One AI call instead of eight** — roughly an 80% cut in PTI cost, and the
model sees the whole vehicle at once, which reads better than isolated shots. The group
message now says "PTI received (7 photos)".

**4. Reminder sends are throttled.**
Telegram allows ~30 sends/second across all chats. A fleet-wide 07:00 reminder to 500
groups would blow through that. Sends are now spaced (~12/second, so 500 groups take about
40 seconds, which nobody notices), and if Telegram does return "too many requests" the bot
waits exactly as long as it asks and retries.

**5. `HANDOFF.md`** — the full project handoff: architecture, access model, all 14
migrations, all 8 functions and their secrets, what's built, conventions, known gaps and
a troubleshooting list. Give this file to any future session as starting context, the same
way the Roadmark handoff worked.

## Update steps

**1. Database** — SQL Editor → run `supabase/migrations/014_hardening.sql`.

**2. Code**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Production hardening + handoff"
git push
```

**3. Redeploy the two changed functions**

```powershell
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy reminders-run
```

## Verify

- Send a BOL photo in a truck group — the prompt should appear **once** (before, a slow
  analysis could produce two).
- Send 4–6 PTI photos together as one batch — you get **one** reply mentioning the photo
  count, not one reply per photo.
- Nothing else changes in the app.

## Cost note at fleet scale

With batching, a 500-truck fleet doing daily PTI plus BOLs lands roughly at $600–900/month
of AI usage rather than $2,000+. If you want it lower still, the next lever is screening
the first pass with the cheaper Haiku model and only escalating flagged batches — say the
word and I'll wire it.
