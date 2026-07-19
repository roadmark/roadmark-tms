-- 016_map.sql — map places: pins synced from Roadmark + pins created in the TMS
--
-- Two kinds of row:
--   company_id IS NULL  → global directory synced from Roadmark (shops, dealers…)
--   company_id SET      → a pin your team dropped (dropped trailer, yard, customer dock…)
--
-- Live layers (parking, weigh stations, weather, traffic) are fetched at view time and
-- are deliberately NOT stored here.

create table if not exists map_places (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,   -- null = global
  source text not null default 'tms' check (source in ('roadmark','tms')),
  external_id text,                                             -- Roadmark's row id
  kind text not null default 'other' check (kind in
    ('repair_shop','dealer','tire_shop','towing','mobile_repair','parking','truck_stop',
     'weigh_station','yard','customer_facility','dropped_trailer','dropped_truck',
     'fuel','hazard','other')),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  address text, city text, state text, zip text,
  phone text, website text, hours text,
  services text[],
  rating numeric(3,2), reviews_count integer,
  note text,

  -- TMS-side curation of a global pin
  preferred boolean not null default false,
  blacklisted boolean not null default false,
  vendor_id uuid references vendors(id) on delete set null,
  negotiated_rate text,

  -- company pin lifecycle
  status text not null default 'active' check (status in ('active','resolved','archived')),
  expected_until timestamptz,
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  load_id uuid references loads(id) on delete set null,

  -- push back to Roadmark as a user submission
  share_to_roadmark boolean not null default false,
  roadmark_submission_id text,
  shared_at timestamptz,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists idx_places_kind on map_places(kind) where company_id is null;
create index if not exists idx_places_company on map_places(company_id, status);
create index if not exists idx_places_bbox on map_places(lat, lng);
create index if not exists idx_places_share on map_places(share_to_roadmark, shared_at)
  where share_to_roadmark and shared_at is null;

-- curation notes a company keeps on a GLOBAL pin (so two carriers don't overwrite each other)
create table if not exists place_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  place_id uuid not null references map_places(id) on delete cascade,
  preferred boolean not null default false,
  blacklisted boolean not null default false,
  vendor_id uuid references vendors(id) on delete set null,
  negotiated_rate text,
  note text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id, place_id)
);

-- when the sync last ran, per source
create table if not exists map_sync_state (
  source text primary key,
  last_synced_at timestamptz,
  last_cursor text,
  last_error text,
  rows_seen integer not null default 0
);

-- ---------------- RLS ----------------
alter table map_places enable row level security;
alter table place_notes enable row level security;
alter table map_sync_state enable row level security;

-- global pins are readable by every signed-in member; company pins only by that company
drop policy if exists places_select on map_places;
create policy places_select on map_places for select
  using (company_id is null or app.is_member(company_id));

-- any member can drop, edit and resolve their own company's pins
drop policy if exists places_write on map_places;
create policy places_write on map_places for all
  using (company_id is not null and app.is_member(company_id))
  with check (company_id is not null and app.is_member(company_id));
-- global rows are written by the sync function (service role, bypasses RLS)

drop policy if exists place_notes_all on place_notes;
create policy place_notes_all on place_notes for all
  using (app.is_member(company_id)) with check (app.is_member(company_id));

drop policy if exists sync_state_select on map_sync_state;
create policy sync_state_select on map_sync_state for select using (auth.uid() is not null);

-- updated_at
drop trigger if exists trg_touch_map_places on map_places;
create trigger trg_touch_map_places before update on map_places
  for each row execute function app.touch_updated_at();

-- realtime so a dropped pin appears for everyone immediately
do $$
begin
  begin execute 'alter publication supabase_realtime add table map_places'; exception when duplicate_object then null; end;
end $$;
