# Demo v9 — Live ELD Tracking (~20 min, includes one new function)

Track & Trace is now a **real map** with your trucks on it, fed by your ELD provider.

## What's new

**Track & Trace**
- Live map (OpenStreetMap — no map API key needed) with a labelled marker per truck:
  **green = moving, amber = stopped, grey = silent over 24 h**.
- Click a truck for its card: driver, current load and delivery due, exact position,
  speed, engine state, last ping — plus **"Help driver — open Roadmark"**, which opens
  roadmark.app centred on that truck's coordinates, and "Open in Maps".
- Table below lists reporting trucks *and* trucks with no ELD position, so a silent truck
  is visible rather than simply missing.
- Refreshes itself every minute; header shows how many are reporting, moving, or silent.

**Admin → ELD & Integrations**
- Add a connection per provider account (Samsara, Motive; EVA and Geotab are listed with
  their status).
- **Your API token is never typed into the app.** The form gives you the exact Supabase
  secret name to create — the token stays server-side and never reaches the browser.
- **Test** verifies the token and reports how many vehicles it can see, without storing
  anything. **Sync now** pulls positions immediately.
- **Vehicle matching** — provider vehicles are matched to your trucks automatically by
  VIN, then by unit number; anything unmatched is listed with a dropdown to link by hand.
- Sync errors surface both here and as a banner on Track & Trace.

Matched trucks also feed odometer readings, which is what PM scheduling will use.

## Update steps

**1. Code** — extract over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
npm install
git add -A
git commit -m "Live ELD tracking"
git push
```

(`npm install` is needed — this version adds the map library.)

**2. Deploy the sync function** — same way you deployed `extract-document`:
- **CLI:** `npx supabase functions deploy telematics-sync`
- **or browser:** Supabase → Edge Functions → Deploy a new function → name it exactly
  `telematics-sync` → paste `supabase/functions/telematics-sync/index.ts` → Deploy.

**3. Connect your provider**
- Get a token: **Samsara** → Settings → API Tokens → create with *Read Vehicle
  Statistics*. **Motive** → Admin → Developers → API Keys → create.
- In the app: Admin → **ELD & Integrations** → **Add connection** → provider, a label,
  and a secret name such as `MAIN_SAMSARA` → Save.
- Add the token in Supabase → Edge Functions → **Secrets**:
  name `TELEMATICS_TOKEN_MAIN_SAMSARA`, value = your token → Save, then redeploy the
  function once so it picks the secret up.
- Back in the app: **Test** (should report the vehicles it found) → **Sync now** → open
  Track & Trace.

**4. Keep it updating automatically** — run once in the Supabase SQL Editor, replacing
both placeholders (service role key: Project Settings → API):

```sql
select cron.schedule('telematics-sync', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.functions.supabase.co/telematics-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb); $$);
```

Check it later with `select jobname, schedule from cron.job;`

## No ELD account yet?

The map and screens still work — trucks appear in the table as "No ELD position", and you
can drop a manual position in the SQL Editor to see a marker:

```sql
insert into unit_locations (company_id, truck_id, lat, lng, speed_mph, engine_state,
                            address_text, located_at, source)
select '11111111-1111-1111-1111-111111111111', id, 41.4993, -81.6944, 62, 'On',
       'I-90 E near Cleveland, OH', now(), 'manual'
from trucks where company_id = '11111111-1111-1111-1111-111111111111' and unit_number = '4114';
```

## Troubleshooting
- **"Function call failed — is telematics-sync deployed?"** → step 2.
- **Test says "Missing secret TELEMATICS_TOKEN_…"** → the secret name must match the
  connection's secret name exactly; add it, then redeploy the function.
- **Samsara 401 / Motive 403** → token lacks read scope, or was revoked.
- **Vehicles appear but no map markers** → those vehicles report no GPS in the feed, or
  they're linked to trucks in a different company.
