# Demo v18 — Live map with Roadmark pins + your own pins

## What it does

**Fleet → Live map** (in Admin for now) is now a real operations map:

**Layers you can toggle** — Trucks · Roadmark directory · Our pins · Preferred only.
A legend underneath counts what's on the map by type.

**Roadmark directory pins** — repair shops, mobile repair, dealers, tire shops, towing,
truck stops, parking, weigh stations. Each with address, phone, website, hours, rating,
and a Directions link.

**Your own notes on a directory shop** — mark it **Preferred** or **Do not use**, record a
negotiated rate ("$95/hr labour, ask for Mike") and a private note. These live in a
separate table per company, so two carriers using the same directory never overwrite each
other, and **your notes never leave the TMS**.

**Drop your own pin** — click **+ Drop a pin**, then click the map. Pick what it is
(dropped trailer, dropped truck, our yard, customer facility, hazard, or a shop/parking
you want to record), name it, add a note, link the trailer or truck, and set how long it's
expected to sit. Exactly your example: *"Trailer D50065 at Pilot #442 — back row near the
fence, keys with the fuel desk, pick up Thursday."* Everyone in your company sees it
immediately, and **Mark resolved** clears it when the trailer is collected.

**Share with Roadmark** — a checkbox on each pin. Tick it and the pin is pushed to
Roadmark as a **user submission** so drivers see it too. Leave it off for anything private
(yards, dropped equipment, customer docks) — that's the default.

Clicking a truck still gives you the truck card with **Help driver — open Roadmark**, and
now also **Drop a pin here**, so a breakdown location becomes a pin in two clicks.

## How the sync works

- Roadmark stays the source of truth for the directory. The TMS keeps a **local copy** in
  `map_places`, refreshed incrementally — so the map is instant and keeps working if
  Roadmark is slow or down.
- With ~3k pins the whole directory sits comfortably in the TMS; no bounding-box queries
  needed.
- The pull uses **Roadmark's own anon key against its public shop tables** — nothing new
  needs building on the Roadmark side to get started.
- The push (your pins → Roadmark user submissions) posts to an endpoint you configure.
  Until that exists, pins simply stay local and the sync reports how many are waiting.
- Live layers you already fetch live in Roadmark (weather, traffic, and live parking or
  scale status) are deliberately **not** copied — those belong at view time.

## Setup

**1. Database** — SQL Editor → run `supabase/migrations/016_map.sql`.

**2. Code**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Live map with Roadmark pins"
git push
```

**3. Sample pins so you can see it now** — SQL Editor → run
`samples/demo_map_pins.sql` (15 directory pins across the Midwest and South, plus three of
your own including a dropped trailer).

**4. Connect Roadmark when you're ready** — deploy the sync function and add the secrets:

```powershell
npx supabase functions deploy map-sync
```

Supabase → Edge Functions → Secrets:
- `ROADMARK_URL` — Roadmark's Supabase project URL
- `ROADMARK_ANON_KEY` — Roadmark's anon key
- `ROADMARK_SUBMIT_URL` *(optional)* — endpoint that accepts a user-submitted place
- `ROADMARK_SUBMIT_KEY` *(optional)* — bearer token for it

Then hit **Sync Roadmark** on the map (admins only) and check the result line.

**Table names are configurable.** The function defaults to `shops` and `dealers`; if
Roadmark calls them something else, invoke it once with the real names:

```json
{ "full": true, "tables": [
  { "name": "recommended_shops", "kind": "repair_shop" },
  { "name": "dealers", "kind": "dealer" }
] }
```

It maps columns generously (`lat`/`latitude`, `name`/`title`/`business_name`, and so on),
so it should fit whatever shape the tables are without changes.

**5. Keep it fresh** — SQL Editor, replacing both placeholders:

```sql
select cron.schedule('map-sync', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/map-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb); $$);
```

## Try it
1. Live map → the directory pins appear; toggle layers off and on.
2. Click a repair shop → mark it **Preferred**, add a rate, save.
3. **+ Drop a pin** → click near a truck stop → "Dropped trailer", link a trailer, note the
   gate code, save. It shows in **Our pins** and on the map in amber.
4. Click a truck → **Drop a pin here** to mark a breakdown spot.
