// map-sync — two-way pin sync with Roadmark
// Deploy as: map-sync
//
// Secrets:
//   ROADMARK_URL           https://<roadmark-project>.supabase.co
//   ROADMARK_ANON_KEY      Roadmark's anon key (the shop directory is public, so read
//                          access needs nothing more)
//   ROADMARK_SUBMIT_URL    (optional) endpoint that accepts a user-submitted place;
//                          without it, TMS pins stay local
//   ROADMARK_SUBMIT_KEY    (optional) bearer token for that endpoint
//
// Body options:
//   {}                       incremental pull + push anything waiting
//   { full: true }           re-pull everything, ignoring the last-sync watermark
//   { push_only: true }      only send TMS pins marked "share with Roadmark"
//
// Table names are configurable so this adapts to whatever Roadmark actually calls them:
//   { tables: [{ name: 'shops', kind: 'repair_shop' }, { name: 'dealers', kind: 'dealer' }] }

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Roadmark's columns may not match ours — map generously, tolerate what's missing. */
function normalize(row: Record<string, any>, kind: string) {
  const lat = row.lat ?? row.latitude ?? row.location_lat ?? row.geo_lat;
  const lng = row.lng ?? row.lon ?? row.longitude ?? row.location_lng ?? row.geo_lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    source: 'roadmark',
    external_id: String(row.id ?? row.uuid ?? row.place_id ?? ''),
    kind: row.kind ?? row.category ?? kind,
    name: row.name ?? row.title ?? row.business_name ?? 'Unnamed',
    lat, lng,
    address: row.address ?? row.street ?? row.address_line1 ?? null,
    city: row.city ?? null,
    state: row.state ?? row.region ?? null,
    zip: row.zip ?? row.postal_code ?? null,
    phone: row.phone ?? row.phone_number ?? null,
    website: row.website ?? row.url ?? null,
    hours: typeof row.hours === 'string' ? row.hours
      : row.hours ? JSON.stringify(row.hours) : null,
    services: Array.isArray(row.services) ? row.services
      : typeof row.services === 'string' ? row.services.split(',').map((s: string) => s.trim())
      : null,
    rating: typeof row.rating === 'number' ? row.rating : null,
    reviews_count: typeof row.reviews_count === 'number' ? row.reviews_count
      : typeof row.review_count === 'number' ? row.review_count : null,
    company_id: null,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { full = false, push_only = false } = body as { full?: boolean; push_only?: boolean };
    const tables = (body as any).tables ?? [
      { name: 'shops', kind: 'repair_shop' },
      { name: 'dealers', kind: 'dealer' },
    ];

    const report: Record<string, unknown> = {};

    /* ---------------- pull from Roadmark ---------------- */
    if (!push_only) {
      const rmUrl = Deno.env.get('ROADMARK_URL');
      const rmKey = Deno.env.get('ROADMARK_ANON_KEY');
      if (!rmUrl || !rmKey) {
        report.pull = 'skipped — ROADMARK_URL / ROADMARK_ANON_KEY not set';
      } else {
        const rm = createClient(rmUrl, rmKey);
        const { data: state } = await admin.from('map_sync_state')
          .select('*').eq('source', 'roadmark').maybeSingle();
        const since = full ? null : state?.last_synced_at;

        let pulled = 0, skipped = 0;
        const errors: string[] = [];

        for (const t of tables) {
          try {
            let q = rm.from(t.name).select('*').limit(5000);
            if (since) q = q.gt('updated_at', since);
            const { data, error } = await q;
            if (error) { errors.push(`${t.name}: ${error.message}`); continue; }

            const rows = (data ?? []).map((r: any) => normalize(r, t.kind)).filter(Boolean);
            skipped += (data?.length ?? 0) - rows.length;

            for (let i = 0; i < rows.length; i += 300) {
              const chunk = rows.slice(i, i + 300).filter((r: any) => r.external_id);
              if (!chunk.length) continue;
              const { error: upErr } = await admin.from('map_places')
                .upsert(chunk, { onConflict: 'source,external_id' });
              if (upErr) { errors.push(`${t.name} upsert: ${upErr.message}`); break; }
              pulled += chunk.length;
            }
          } catch (e) { errors.push(`${t.name}: ${String(e).slice(0, 120)}`); }
        }

        await admin.from('map_sync_state').upsert({
          source: 'roadmark',
          last_synced_at: new Date().toISOString(),
          rows_seen: pulled,
          last_error: errors.length ? errors.join(' · ').slice(0, 500) : null,
        });
        report.pull = { pulled, skipped_no_coords: skipped, errors };
      }
    }

    /* ---------------- push TMS pins back as user submissions ---------------- */
    const submitUrl = Deno.env.get('ROADMARK_SUBMIT_URL');
    const { data: waiting } = await admin.from('map_places')
      .select('id, name, kind, lat, lng, address, city, state, phone, website, note')
      .eq('source', 'tms').eq('share_to_roadmark', true).is('shared_at', null).limit(100);

    if (!submitUrl) {
      report.push = `skipped — ROADMARK_SUBMIT_URL not set (${waiting?.length ?? 0} pin(s) waiting)`;
    } else {
      let sent = 0; const pushErrors: string[] = [];
      for (const p of waiting ?? []) {
        try {
          const res = await fetch(submitUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(Deno.env.get('ROADMARK_SUBMIT_KEY')
                ? { Authorization: `Bearer ${Deno.env.get('ROADMARK_SUBMIT_KEY')}` } : {}),
            },
            body: JSON.stringify({
              name: p.name, kind: p.kind, lat: p.lat, lng: p.lng,
              address: p.address, city: p.city, state: p.state,
              phone: p.phone, website: p.website, note: p.note,
              submitted_by: 'roadmark-tms',
            }),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) { pushErrors.push(`${p.name}: ${res.status}`); continue; }
          await admin.from('map_places').update({
            shared_at: new Date().toISOString(),
            roadmark_submission_id: String(out.id ?? out.submission_id ?? ''),
          }).eq('id', p.id);
          sent++;
        } catch (e) { pushErrors.push(`${p.name}: ${String(e).slice(0, 100)}`); }
      }
      report.push = { sent, errors: pushErrors };
    }

    return json({ ok: true, ...report });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
