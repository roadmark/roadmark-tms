// telematics-sync — Roadmark TMS ELD/telematics poller
// Deploy as function name: telematics-sync
// Secrets needed: one per connection, named TELEMATICS_TOKEN_{secret_ref}
//   e.g. secret_ref "MAIN_SAMSARA"  ->  TELEMATICS_TOKEN_MAIN_SAMSARA
//
// Call modes:
//   {}                              -> sync every active connection (used by cron)
//   { connection_id: "uuid" }       -> sync one connection
//   { connection_id: "uuid", test: true } -> fetch vehicles only, store nothing, report back

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Point = {
  external_id: string;
  external_name?: string;
  external_vin?: string;
  lat?: number; lng?: number;
  speed_mph?: number; heading?: number;
  odometer_miles?: number;
  engine_state?: string;
  address_text?: string;
  located_at?: string;
  raw?: unknown;
};

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);

/* ----------------------------- Samsara ----------------------------- */
async function samsara(token: string, baseUrl: string | null, cursor: string | null) {
  const base = baseUrl || 'https://api.samsara.com';
  const url = new URL(`${base}/fleet/vehicles/stats/feed`);
  url.searchParams.set('types', 'gps,obdOdometerMeters,engineStates');
  if (cursor) url.searchParams.set('after', cursor);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Samsara ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();

  const points: Point[] = [];
  for (const v of body.data ?? []) {
    const gpsArr = Array.isArray(v.gps) ? v.gps : (v.gps ? [v.gps] : []);
    const odoArr = Array.isArray(v.obdOdometerMeters) ? v.obdOdometerMeters : (v.obdOdometerMeters ? [v.obdOdometerMeters] : []);
    const engArr = Array.isArray(v.engineStates) ? v.engineStates : (v.engineStates ? [v.engineStates] : []);
    const gps = gpsArr[gpsArr.length - 1];
    const odo = odoArr[odoArr.length - 1];
    const eng = engArr[engArr.length - 1];
    points.push({
      external_id: String(v.id),
      external_name: v.name ?? undefined,
      external_vin: v.externalIds?.['samsara.vin'] ?? v.vin ?? undefined,
      lat: num(gps?.latitude), lng: num(gps?.longitude),
      speed_mph: num(gps?.speedMilesPerHour),
      heading: num(gps?.headingDegrees),
      odometer_miles: num(odo?.value) !== undefined ? Number(odo.value) / 1609.344 : undefined,
      engine_state: eng?.value ?? undefined,
      address_text: gps?.reverseGeo?.formattedLocation ?? undefined,
      located_at: gps?.time ?? odo?.time ?? eng?.time ?? new Date().toISOString(),
      raw: v,
    });
  }
  return { points, cursor: body.pagination?.endCursor ?? cursor };
}

/* ------------------------------ Motive ------------------------------ */
async function motive(token: string, baseUrl: string | null) {
  const base = baseUrl || 'https://api.gomotive.com';
  const res = await fetch(`${base}/v3/vehicle_locations?per_page=100`, {
    headers: { 'X-Api-Key': token, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Motive ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();

  const list = body.vehicles ?? body.data ?? [];
  const points: Point[] = [];
  for (const item of list) {
    const v = item.vehicle ?? item;
    const loc = v.current_location ?? v.location ?? {};
    points.push({
      external_id: String(v.id ?? v.vehicle_id ?? ''),
      external_name: v.number ?? v.name ?? undefined,
      external_vin: v.vin ?? undefined,
      lat: num(loc.lat ?? loc.latitude),
      lng: num(loc.lon ?? loc.lng ?? loc.longitude),
      speed_mph: num(loc.speed),
      heading: num(loc.bearing ?? loc.heading),
      odometer_miles: num(v.current_odometer ?? loc.odometer),
      engine_state: loc.engine_state ?? undefined,
      address_text: loc.description ?? loc.formatted ?? undefined,
      located_at: loc.located_at ?? loc.time ?? new Date().toISOString(),
      raw: item,
    });
  }
  return { points, cursor: null };
}

/* ------------------------------- main ------------------------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const payload = await req.json().catch(() => ({}));
    const { connection_id, test } = payload as { connection_id?: string; test?: boolean };

    let q = admin.from('telematics_connections').select('*').eq('status', 'active');
    if (connection_id) q = admin.from('telematics_connections').select('*').eq('id', connection_id);
    const { data: conns, error: cErr } = await q;
    if (cErr) throw cErr;
    if (!conns?.length) return json({ ok: true, message: 'No active connections' });

    const report: Record<string, unknown>[] = [];

    for (const c of conns) {
      const secretName = `TELEMATICS_TOKEN_${c.secret_ref}`;
      const token = Deno.env.get(secretName);
      if (!token) {
        await admin.from('telematics_connections')
          .update({ status: 'error', last_error: `Secret ${secretName} is not set` }).eq('id', c.id);
        report.push({ connection: c.label, error: `Missing secret ${secretName}` });
        continue;
      }

      try {
        const got = c.provider === 'samsara' ? await samsara(token, c.base_url, c.sync_cursor)
          : c.provider === 'motive' ? await motive(token, c.base_url)
          : (() => { throw new Error(`Provider "${c.provider}" has no adapter yet`); })();

        const { points, cursor } = got;

        if (test) {
          report.push({
            connection: c.label, provider: c.provider, vehicles_found: points.length,
            sample: points.slice(0, 3).map((p) => ({ id: p.external_id, name: p.external_name, has_gps: p.lat !== undefined })),
          });
          await admin.from('telematics_connections')
            .update({ status: 'active', last_error: null }).eq('id', c.id);
          continue;
        }

        // trucks in this company, for auto-matching
        const { data: trucks } = await admin.from('trucks')
          .select('id, unit_number, vin').eq('company_id', c.company_id);
        const byVin = new Map((trucks ?? []).filter((t) => t.vin).map((t) => [String(t.vin).toUpperCase(), t.id]));
        const byUnit = new Map((trucks ?? []).map((t) => [String(t.unit_number).toLowerCase().trim(), t.id]));

        const { data: known } = await admin.from('telematics_units')
          .select('id, external_id, truck_id').eq('connection_id', c.id);
        const knownMap = new Map((known ?? []).map((u) => [u.external_id, u]));

        let stored = 0, matched = 0;
        for (const p of points) {
          if (!p.external_id) continue;
          let truckId = knownMap.get(p.external_id)?.truck_id ?? null;
          if (!truckId) {
            if (p.external_vin && byVin.has(p.external_vin.toUpperCase())) truckId = byVin.get(p.external_vin.toUpperCase())!;
            else if (p.external_name && byUnit.has(p.external_name.toLowerCase().trim())) truckId = byUnit.get(p.external_name.toLowerCase().trim())!;
          }
          if (truckId) matched++;

          await admin.from('telematics_units').upsert({
            connection_id: c.id, company_id: c.company_id,
            external_id: p.external_id, external_name: p.external_name ?? null,
            external_vin: p.external_vin ?? null, unit_type: 'truck',
            truck_id: truckId, matched: !!truckId, updated_at: new Date().toISOString(),
          }, { onConflict: 'connection_id,external_id' });

          if (p.lat !== undefined && p.lng !== undefined) {
            await admin.from('unit_locations').insert({
              company_id: c.company_id, truck_id: truckId,
              lat: p.lat, lng: p.lng,
              speed_mph: p.speed_mph ?? null, heading: p.heading ?? null,
              odometer_miles: p.odometer_miles ?? null,
              engine_state: p.engine_state ?? null,
              address_text: p.address_text ?? null,
              located_at: p.located_at ?? new Date().toISOString(),
              source: 'api', provider: c.provider, raw: p.raw ?? null,
            });
            stored++;

            // feed PM: keep an odometer trail on matched trucks
            if (truckId && p.odometer_miles !== undefined) {
              await admin.from('odometer_readings').insert({
                company_id: c.company_id, truck_id: truckId,
                reading: Math.round(p.odometer_miles), source: 'eld',
              });
            }
          }
        }

        await admin.from('telematics_connections').update({
          status: 'active', last_error: null, last_sync_at: new Date().toISOString(),
          sync_cursor: cursor ?? c.sync_cursor,
        }).eq('id', c.id);

        report.push({ connection: c.label, provider: c.provider, vehicles: points.length, positions_stored: stored, matched_to_trucks: matched });
      } catch (e) {
        await admin.from('telematics_connections')
          .update({ status: 'error', last_error: String(e).slice(0, 500) }).eq('id', c.id);
        report.push({ connection: c.label, error: String(e).slice(0, 300) });
      }
    }

    return json({ ok: true, report });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
