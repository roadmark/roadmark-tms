# Roadmark TMS — Demo Setup (live website in ~45 minutes)

You will end with: a **live website** (your-name.vercel.app) where you and anyone you
invite can log in and use the demo — Overview, Loads, Customers, Drivers, Trucks &
Trailers, Maintenance, Accounting, Track & Trace, the **Assistants page** (detailed bot
playbooks + live activity feed per department), and Admin. Realtime works: edit a load
in one browser, watch it change in another.

Everything is copy-paste. Placeholders in ALL_CAPS.

---

## 1. Supabase — database (15 min)

1. supabase.com/dashboard → **New project** → name `roadmark-tms`, region `us-east-1`,
   generate a DB password and save it → Create.
2. When it finishes: **Project Settings → API** → copy **Project URL** and
   **anon public** key. Keep this tab open.
3. **Database → Extensions** → enable `pg_cron` and `pg_net`.
4. **SQL Editor** → for each file in `supabase/migrations/`, in this exact order, paste
   the whole file and click **Run**:
   `001_core.sql, 002_people.sql, 003_fleet.sql, 004_dispatch.sql, 005_documents_ai.sql,
   006_accounting.sql, 007_settlements_payroll.sql, 008_insurance.sql,
   009_telematics.sql, 010_finalize.sql, 011_assistants.sql, 012_department_feed.sql`
   Each must end **Success**. (They are safe to re-run if you make a mistake.)
5. **SQL Editor** → paste and Run `supabase/demo_seed.sql`. The output table at the end
   should show `companies 1, drivers 3, loads 3, activity rows 24`.
6. **Authentication → Sign In / Providers**: Email = ON. Then under Auth settings turn
   **OFF** "Allow new users to sign up" (accounts are invite-only).

## 2. Your login (2 min — no emails involved)

Two things make a working account: a **login** (email + password, lives in Supabase
Auth) and a **membership row** that tells the TMS which company that login belongs to
and with which role. You create both here.

1. **Authentication → Users → Add user → Create new user** → type your email and a
   password, tick **Auto Confirm User** → Create. (Don't use "Invite user" for the demo
   — invite emails redirect to a Site URL you haven't configured yet.)
2. Copy the new user's **UID** from the users list.
3. **SQL Editor**, run (paste your UID):

```sql
insert into company_members (company_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'YOUR_USER_UID', 'master_admin');
```

That company id is the seeded demo company — fixed on purpose so this is copy-paste.

**Adding colleagues:** same two steps with their email and role. A dispatch team leader:

```sql
insert into company_members (company_id, user_id, role, department)
values ('11111111-1111-1111-1111-111111111111', 'THEIR_USER_UID', 'team_leader', 'dispatch');
```

They can then **view everything** but **edit only dispatch** — try it.

**For later (real invites by email):** Authentication → URL Configuration → set
**Site URL** to your live Vercel URL and add `http://localhost:5173` to Redirect URLs.
Until that's set, invite links point to localhost:3000 and go nowhere — that's why the
demo uses Create new user instead.

## 3. Run it on your computer first (10 min)

Requirements: Node.js 18+ (nodejs.org, LTS installer, next-next-finish).

```powershell
cd C:\Projects
# put the roadmark-tms folder from the zip here, then:
cd roadmark-tms
npm install
copy .env.example .env.local
notepad .env.local   # paste your Project URL and anon key, save
npm run dev
```

Open http://localhost:5173 → sign in with the account from step 2. You should see the
Overview with counters and the assistant feed, three loads, three drivers, trucks with
ELD rows in Track & Trace, and the Assistants page fully populated.

## 4. Put it on a live website (10 min)

1. Push the code to GitHub:

```powershell
cd C:\Projects\roadmark-tms
git init
git add -A
git commit -m "Roadmark TMS demo"
gh repo create sajks/roadmark-tms --private --source . --push
```

(If `gh` isn't installed: create an empty private repo `roadmark-tms` on github.com,
then `git remote add origin https://github.com/sajks/roadmark-tms.git` and
`git push -u origin main`.)

2. vercel.com → **Add New → Project** → Import `sajks/roadmark-tms`.
3. It detects Vite automatically. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. **Deploy.** Two minutes later you have `https://roadmark-tms-….vercel.app` — open it
   on your phone and log in. Send the URL + invites to whoever should try the demo.
5. From now on, any `git push` updates the live site automatically.
6. Custom domain later: Vercel → Settings → Domains → `tms.roadmark.app` → add the
   CNAME it shows you at your DNS provider.

## 5. What to demo (a 10-minute tour)

1. **Overview** — company counters + merged assistant feed.
2. **Loads** — open load #1 (in progress, Houston → Rochester "(+1)"), change something,
   watch it update instantly in a second browser window. Create a new load — the load
   number assigns itself.
3. **Assistants** — the page you asked for: all five bot playbooks written out
   action-by-action, plus the live feed filterable by department. The seeded rows show
   exactly how real actions will look: BOL approved → loaded notice sent, hourly
   tracking updates, MED-expiry reminder (shows under **Safety**), flagged PTI (under
   **Safety and Maintenance**), and a closed accident drill (under five departments).
4. **Safety → Drivers** — the MED reminder and flagged PTI appear in Safety's own
   "Assistant activity" panel at the bottom. Same pattern on Fleet, Maintenance,
   Accounting, Track & Trace.
5. **Accounting** — the settlements overview strip is computed live from the seeded
   fuel/tolls/deductions/truck-rent data.
6. **Admin** — users & roles; invite a colleague as a `team_leader` of one department
   and show view-everything / edit-own-department in action.

## 6. Troubleshooting

- **Blank page** → `.env.local` missing or wrong; the app shows a message naming the
  missing variables. Restart `npm run dev` after editing.
- **"Almost there — not a member of any company"** → run the §2 membership insert with
  YOUR user UID, refresh.
- **Invite email links to localhost:3000** → Site URL not configured; for the demo use Add user → Create new user with a password (§2), and set Site URL once the site is live.
- **Login says invalid credentials** → the invite wasn't completed; re-invite from
  Authentication → Users.
- **Tables empty** → `demo_seed.sql` not run, or run before migrations; run it now.
- **Edits rejected ("row-level security")** → your role can't edit that department —
  working as designed; use the master_admin account.

## 7. What the demo deliberately leaves out (it's in the build plan)

Multi-stop entry, documents & AI rate-con intake (Phase 5), maintenance editor with AI
invoice scan (6), fuel/toll CSV import + settlements run (7–8), insurance & payroll (9),
live map with real ELD sync (10), and the Telegram bots themselves (13) — the Assistants
page documents their exact behavior until then. The `supabase/migrations` folder in this
zip is the full production schema, so nothing gets thrown away: the demo grows into the
real system phase by phase.
