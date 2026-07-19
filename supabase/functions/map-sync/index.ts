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

/** Roadmark's shop_type / category values → our kind enum. */
const KIND_MAP: Record<string, string> = {
  repair: 'repair_shop', 'repair shop': 'repair_shop', repair_shop: 'repair_shop',
  mechanic: 'repair_shop', shop: 'repair_shop', truck_repair: 'repair_shop',
  trailer_repair: 'repair_shop', diesel: 'repair_shop',
  mobile: 'mobile_repair', 'mobile repair': 'mobile_repair', mobile_repair: 'mobile_repair',
  roadservice: 'mobile_repair', road_service: 'mobile_repair',
  tire: 'tire_shop', tires: 'tire_shop', tire_shop: 'tire_shop',
  tow: 'towing', towing: 'towing', wrecker: 'towing', recovery: 'towing',
  dealer: 'dealer', dealership: 'dealer', parts: 'dealer',
  parking: 'parking', lot: 'parking',
  truckstop: 'truck_stop', 'truck stop': 'truck_stop', truck_stop: 'truck_stop',
  fuel: 'fuel', fuel_stop: 'fuel',
  scale: 'weigh_station', weigh: 'weigh_station', weigh_station: 'weigh_station',
};
const toKind = (v: unknown, fallback: string) => {
  const k = String(v ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return KIND_MAP[k] ?? KIND_MAP[k.replace(/_/g, ' ')] ?? fallback;
};

/** Ownership words that say nothing about what the shop does. */
const OWNERSHIP_WORDS = new Set(['chain', 'independent', 'community', 'franchise', 'mechanic', 'shop']);

/** A shop's real speciality decides the pin: tyres, towing, mobile, dealer — else repair. */
function kindFromSpecialties(list: string[] | null, shopType: unknown, fallback: string) {
  const hay = (list ?? []).join(' ').toLowerCase();
  if (/\btow|wrecker|recovery/.test(hay)) return 'towing';
  if (/\btire|tyre/.test(hay)) return 'tire_shop';
  if (/mobile|road ?service|on.?site/.test(hay)) return 'mobile_repair';
  if (/dealer|dealership|parts counter/.test(hay)) return 'dealer';
  if (/parking|overnight lot/.test(hay)) return 'parking';
  if (/truck ?stop|fuel/.test(hay)) return 'truck_stop';
  const st = String(shopType ?? '').toLowerCase().trim();
  if (st && !OWNERSHIP_WORDS.has(st)) return toKind(st, fallback);
  return fallback;
}

/** Roadmark's columns may not match ours — map generously, tolerate what's missing. */
function normalize(row: Record<string, any>, kind: string) {
  const lat = row.lat ?? row.latitude ?? row.location_lat ?? row.geo_lat;
  const lng = row.lng ?? row.lon ?? row.longitude ?? row.location_lng ?? row.geo_lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const services = (() => {
    const raw = row.services ?? row.specialties;
    if (Array.isArray(raw)) return raw.map((x: unknown) => String(x));
    if (typeof raw === 'string' && raw.trim()) {
      return raw.replace(/^{|}$/g, '').split(',').map((x: string) => x.trim().replace(/^"|"$/g, ''));
    }
    return null;
  })();

  return {
    source: 'roadmark',
    external_id: String(row.id ?? row.uuid ?? row.place_id ?? ''),
    kind: row.kind ?? row.category
      ? toKind(row.kind ?? row.category, kind)
      : kindFromSpecialties(services, row.shop_type, kind),
    name: row.name ?? row.title ?? row.business_name ?? 'Unnamed',
    lat, lng,
    address: row.address ?? row.street ?? row.address_line1 ?? null,
    city: row.city ?? null,
    state: row.state ?? row.region ?? null,
    zip: row.zip ?? row.postal_code ?? null,
    phone: row.phone ?? row.phone_number ?? null,
    website: row.website ?? row.url ?? null,
    hours: row.open_24 ? 'Open 24 hours'
      : typeof row.hours === 'string' ? row.hours
      : (row.hours_weekday || row.hours_sat || row.hours_sun)
        ? [row.hours_weekday && `Mon–Fri ${row.hours_weekday}`,
           row.hours_sat && `Sat ${row.hours_sat}`,
           row.hours_sun && `Sun ${row.hours_sun}`].filter(Boolean).join(' · ')
      : row.hours ? JSON.stringify(row.hours) : null,
    services,
    rating: typeof row.rating === 'number' ? row.rating
      : typeof row.avg_rating === 'number' ? row.avg_rating : null,
    reviews_count: typeof row.reviews_count === 'number' ? row.reviews_count
      : typeof row.review_count === 'number' ? row.review_count : null,
    note: [
      row.brand ? `Brand: ${row.brand}` : null,
      row.shop_type ? `Type: ${row.shop_type}` : null,
      row.description ?? row.owner_note ?? null,
    ].filter(Boolean).join(' · ') || null,
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
    // Roadmark's real layout: shops carry their own shop_type, parking is its own table.
    const tables: Array<{ name: string; kind: string; status?: string; status_in?: string[] }> =
      (body as any).tables ?? [
        { name: 'shops', kind: 'repair_shop' },
        { name: 'parking', kind: 'parking' },
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
            const build = (useSince: boolean) => {
              let q = rm.from(t.name).select('*').limit(10000);
              // only take rows this table considers live, when a status filter is given
              if (t.status_in?.length) q = q.in('status', t.status_in);
              else if (t.status) q = q.eq('status', t.status);
              if (useSince && since) q = q.gt('updated_at', since);
              return q;
            };
            let { data, error } = await build(true);
            // tables without an updated_at column can't do incremental — fall back to full
            if (error && /updated_at/i.test(error.message || '')) {
              ({ data, error } = await build(false));
            }
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
