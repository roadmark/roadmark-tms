# ROADMARK TMS — HANDOFF

**Date:** July 19, 2026 · **Status:** demo complete and live, ready for parallel-run testing

Give this file to any future session (or person) as the starting context, the same way the
Roadmark handoff worked.

---

## 1. What this is

Roadmark TMS is the carrier operations platform for the trucking company — dispatch,
accounting, settlements, safety, fleet, maintenance, tracking — with AI document intake
and Telegram assistants for the drivers. It replaces a legacy third-party TMS. It is a
separate product from **Roadmark** (roadmark.app, the road-side/repair PWA) and only links
out to it.

**Live site:** https://roadmark-tms.vercel.app
**Repo:** github.com/roadmark/roadmark-tms (private) — account `roadmark`, jansto991@gmail.com
**Local path:** `C:\TRUCKWRENCH\roadmark-tms`
**Supabase project ref:** `tvyeelhloyffpvcwyfvh`

## 2. Stack

- React 18 + Vite, React Router, TanStack Query v5, plain CSS design tokens
- Supabase: Postgres + Auth + Storage + Realtime + Edge Functions (Deno) + pg_cron/pg_net
- Vercel hosting, auto-deploy from `main`
- Anthropic API (claude-sonnet-4-6) for all document/photo reading
- Leaflet + OpenStreetMap for the fleet map (no map API key)
- Telegram Bot API for driver groups; Gmail API for broker email

## 3. Access model (important — this drives every RLS policy)

`company_members` carries **role** + **department**.

- Roles: `master_admin`, `general_manager`, `manager`, `team_leader`, `member`
- Departments: `dispatch`, `accounting`, `safety`, `fleet`, `maintenance`, `tracking`

**Rule: everyone can VIEW everything; only a department's manager/team leader (plus
master_admin and general_manager) can EDIT that department's data.**

Three deliberate privacy exceptions, each one policy line to change:
`driver_private` (SSN/DOB/banking), `employees`/`employees_private` (salaries),
`settlements`/`payroll` — all limited to accounting + admins.

DB helpers: `app.is_member(cid)`, `app.can_edit(cid, dept)`, `app.is_admin(cid)`.
Frontend mirror: `src/data/permissions.js` (`canEdit`, `canApprove`, `isAdmin`).

Multi-company: one Supabase project, company switcher in the header, RLS scoped by
`company_id`. Demo company id is `11111111-1111-1111-1111-111111111111`.

## 4. Database

14 migrations in `supabase/migrations/`, run in order in the SQL Editor. All were validated
against a real Postgres before shipping.

| File | Contents |
|---|---|
| 001_core | companies, profiles, company_members, RLS helpers, audit_log, notifications |
| 002_people | drivers (+private), employees (+private), compliance types/items |
| 003_fleet | trucks, trailers, leases, assignments, vendors, maintenance invoices/tasks, PM, odometers |
| 004_dispatch | customers, loads (auto load_number), load_stops, status history, check calls |
| 005_documents_ai | documents registry, extraction_jobs, import_batches, `company-docs` bucket + policies |
| 006_accounting | invoices/payments, fuel, tolls, deductions, recurring deductions, credits, balance due, escrow, expenses |
| 007_settlements_payroll | settlements + lines, payroll runs + lines |
| 008_insurance | policies (9 types) + enrollments |
| 009_telematics | connections, units, unit_locations, `v_unit_latest_location` |
| 010_finalize | updated_at/audit triggers, views, cron jobs, realtime publication |
| 011_assistants | email mailboxes/threads, templates, tracking_subscriptions, telegram groups/identities, assistant_actions, reminders, pti_inspections, incident_reports |
| 012_department_feed | `departments` attribution + `v_department_activity` (powers every "Assistant activity" panel) |
| 013_email | email_credentials (RLS on, **no policies** — only service role can read tokens), default templates |
| 014_hardening | pti media_group_id, telegram_updates dedupe table |

Conventions: uuid PKs, `company_id` everywhere, `numeric(12,2)` money, statuses as CHECK
constraints mirrored in `src/data/enums.js`. Additive migrations only. Verify CHECK values
before bulk inserts.

## 5. Edge functions

| Function | Purpose | Deploy note |
|---|---|---|
| `extract-document` | Rate cons, repair invoices, BOLs → JSON | |
| `telematics-sync` | Samsara/Motive pollers → unit_locations | cron every 2 min |
| `telegram-webhook` | Driver-group bots (BOL, PTI, accidents, commands) | **`--no-verify-jwt`** |
| `reminders-run` | Compliance/PM/appointment reminders, throttled sends | cron hourly |
| `email-oauth` | Google consent code → refresh token | |
| `email-sync` | Mirrors Gmail thread envelopes, auto-links to loads | cron every 10 min |
| `email-send` | Reply-all into a broker thread (loaded notice, updates) | |
| `tracking-updates` | Hourly broker location emails per subscription | cron every 5 min |

**Secrets** (Supabase → Edge Functions → Secrets):
`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`TELEMATICS_TOKEN_{ref}` per ELD connection (the ref is on the connection row).
Optional: `TELEGRAM_WEBHOOK_SECRET`.

**Vercel env:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`.
Never put the service role key or any client secret in the app.

## 6. What's built (all live)

**Dispatch** — Board (per-dispatcher gross/RPM/deadhead/miles), Loads with AI rate-con
intake, multi-stop editor, documents, broker conversation panel; Trip Activity grouped by
driver/truck/trailer/customer/dispatcher; Customers.

**Fleet** — trucks/trailers with CSV import; Assignments (one active per driver/truck/
trailer, history preserved).

**Maintenance** — invoices with AI intake, task lines with On Company/On Driver split,
auto-created driver deductions named `{PAYMENT}-Repair-{Vendor}-{Invoice#}`.

**Accounting** — Overview balances, Fuel and Tolls with CSV import + driver/unit matching,
Deductions, **Settlements** (gather → draft → approve → paid/void, negative nets carry
forward as balance due), **Invoices** (generate from delivered loads, aging, payments with
short/over pay), **Payroll** (staff + runs).

**Safety** — Drivers (CSV import), Compliance with expiry tracking and documents,
Insurance policies + enrollments.

**Tracking** — live Leaflet map, truck cards with "Help driver → Roadmark" deep link,
ELD connection management with token-by-secret pattern.

**Assistants** — Telegram BOL approval → attaches BOL, marks loaded, sends the broker
loaded notice; PTI screening (batched per photo group); accident detection (keyword +
AI layer, multilingual) tagging five departments; reminder engine. Every action lands in
`v_department_activity` and shows in that department's module.

**Cross-cutting** — global search, realtime sync, audit log, CSV export everywhere.

## 7. Working conventions

- Updates arrive as a zip; extract over `C:\TRUCKWRENCH\roadmark-tms` replacing all, then
  `git add -A` → `git commit -m "..."` → `git push`. Vercel deploys in ~2 min.
- `npm install` only when a release says it adds a library.
- SQL is additive and run manually in the SQL Editor.
- `main` = production. Test locally with `npm run dev` (localhost:5173) against the same DB.

## 8. Known gaps / next work

1. **Not yet parallel-run against the old system.** Highest priority: one real pay week
   end to end, reconciled to the cent.
2. **Scale of the bots.** Background processing, update dedupe, PTI batching and send
   throttling are in (v13). Still worth watching: AI cost at fleet scale (~$1,500–2,500/mo
   at 500 trucks doing daily PTI — reduce with Haiku for first-pass screening or sampling).
3. **EVA ELD** has no public API; adapter interface is ready, CSV fallback works.
4. **IFTA, QuickBooks sync, DAT/Truckstop** intentionally out of scope so far.
5. **Escrow, PM schedules, expenses, check calls** have tables and partial UI — not full
   screens yet.
6. Gmail External-mode caveat: if the connected mailbox is a personal gmail.com under an
   "External / Testing" OAuth app, refresh tokens expire every 7 days. Use Workspace +
   Internal, or publish the app.

## 9. If something breaks

- App shows "Missing configuration" → Vercel env vars absent or build ran before they were added.
- RLS errors on save → the user's role/department can't edit that data (working as designed).
- Extraction fails → Supabase → Edge Functions → extract-document → Logs; and
  `select status, error from extraction_jobs order by created_at desc limit 5;`
- Bot silent → BotFather privacy mode must be **Disabled**; webhook must be set; function
  deployed with `--no-verify-jwt`. Check `getWebhookInfo`.
- Email won't send → load needs a linked thread; check `email_mailboxes.last_error`.
- Cron not firing → `select jobname, schedule from cron.job;` and
  `select * from cron.job_run_details order by start_time desc limit 10;`
