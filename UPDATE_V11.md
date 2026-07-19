# Demo v11 — Dispatch Board, Trip Activity, Search, Data Import, Reminders

The finishing round. Five additions, one new function.

## 1. Dispatch · Board

Per-dispatcher performance for any date range (defaults to this week):
- Loads, drivers covered, **gross**, driver pay, **margin**
- **RPM total and loaded**, miles per load, **deadhead %**, gross per driver, miles per driver
- A breakdown by equipment type when a dispatcher runs mixed trailers
- Each dispatcher's loads listed underneath with per-load $/mi
- Company KPI strip across the top

Loads now carry a **dispatcher** (defaults to whoever creates the load, editable in the
load drawer) — that's what the board groups by.

## 2. Dispatch · Trip activity

The same period, regrouped: **by driver, truck, trailer, customer or dispatcher**. Each
group shows loads, loaded/empty/total miles, gross, driver pay, **difference**, $/mi and
deadhead %. Click any group to expand the individual loads. Export CSV.

Answers the questions you actually ask: which customer pays best per mile, which truck
runs the most deadhead, what a driver really earned this month.

## 3. Global search

Search box in the top bar — load numbers, broker references, driver names, unit numbers,
VINs and customers, all at once. Two characters is enough.

## 4. Import your real data

The CSV wizard now handles master data, not just fuel and tolls. **Import CSV** buttons on:
- **Safety → Drivers** — names, phones, CDL, type, status, pay rate, hire date
- **Fleet → Units** — trucks and trailers with VIN, make/model/year, ownership, plates
- **Dispatch → Customers** — brokers with MC#, billing email, payment terms

Same mapping screen (your column names don't need to match), same remembered mappings, and
**duplicate protection on the natural key** — re-importing a list only adds what's new.
Statuses and types are normalized ("Lease To Buy" → `lease_to_buy`); anything unrecognized
falls back to a safe default rather than failing the row.

This is what you'll use to migrate off the old system. Suggested order:
**customers → drivers → trucks → trailers**, then assignments by hand, then open loads.

## 5. Reminder engine (`reminders-run`)

A function that, on each run:
- creates reminders for **compliance expiring in 14 and 3 days** (tagging safety, plus the
  driver), **PM due within 1,000 miles** (maintenance and fleet), and **appointments 2 hours
  out** (dispatch and the driver)
- posts them to the truck's Telegram group when one is linked, tagging the right people
- records every one in **assistant_actions**, so it shows in that department's feed inside
  the TMS even with no Telegram connected

## Update steps

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Board, trip activity, search, data import, reminders"
git push
```

(extract the zip over the folder first; no `npm install` needed)

**Deploy the reminder function** (optional — everything else works without it):

```powershell
npx supabase functions deploy reminders-run
```

Then schedule it hourly in the SQL Editor (replace both placeholders):

```sql
select cron.schedule('reminders-run', '0 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/reminders-run',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb); $$);
```

Test it once by hand first: Supabase → Edge Functions → reminders-run → **Invoke** with
body `{}`. It returns `{"generated":N,"sent":N}`. If you ran the compliance seed from v7,
Marcus's medical card (14 days out) should generate one, and it will appear in **Safety →
assistant activity**.

## Try it
1. **Dispatch → Board** — set the range to cover the seeded loads. Assign a dispatcher on
   a load or two first (open a load, pick the Dispatcher field) so they group under a name.
2. **Trip activity** — switch grouping to **customer**, expand a row, then export.
3. **Search** — type `4114`, then a driver's name, then a broker's name.
4. **Import** — export a few drivers from your old system as CSV and import them.
