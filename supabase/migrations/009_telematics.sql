-- 009_telematics.sql — ELD/telematics connections and locations

create table if not exists telematics_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null check (provider in ('samsara','motive','eva','geotab','other')),
  label text not null,               -- "Samsara main account"
  -- The API token itself is NEVER stored here. It lives as an edge function secret
  -- named TELEMATICS_TOKEN_{secret_ref}. This column holds only the reference.
  secret_ref text not null,          -- e.g. 'B2B_SAMSARA' -> secret TELEMATICS_TOKEN_B2B_SAMSARA
  base_url text,                     -- override if the provider has custom base
  status text not null default 'active' check (status in ('active','paused','error')),
  sync_cursor text,                  -- Samsara feed endCursor etc.
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists telematics_units (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references telematics_connections(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,         -- provider's vehicle/asset id
  external_name text,                -- provider's display name (often the unit number)
  external_vin text,
  unit_type text not null default 'truck' check (unit_type in ('truck','trailer')),
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  matched boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table if not exists unit_locations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  truck_id uuid references trucks(id) on delete cascade,
  trailer_id uuid references trailers(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed_mph numeric(6,1),
  heading numeric(5,1),
  odometer_miles numeric(10,1),
  engine_state text,                 -- On / Off / Idle
  address_text text,                 -- reverse geocode when the provider gives it
  located_at timestamptz not null,
  source text not null default 'api' check (source in ('api','phone','manual')),
  provider text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_locations_truck_time on unit_locations(truck_id, located_at desc);
create index if not exists idx_locations_company_time on unit_locations(company_id, located_at desc);

-- latest location per truck (fast map rendering)
create or replace view v_unit_latest_location as
select distinct on (truck_id)
  company_id, truck_id, lat, lng, speed_mph, heading, odometer_miles,
  engine_state, address_text, located_at, source, provider
from unit_locations
where truck_id is not null
order by truck_id, located_at desc;

-- RLS
do $$
declare t text;
begin
  foreach t in array array['telematics_connections','telematics_units','unit_locations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
  end loop;
end $$;

drop policy if exists tc_write on telematics_connections;
create policy tc_write on telematics_connections for all
  using (app.can_edit(company_id,'tracking'))
  with check (app.can_edit(company_id,'tracking'));

drop policy if exists tu_write on telematics_units;
create policy tu_write on telematics_units for all
  using (app.can_edit(company_id,'tracking'))
  with check (app.can_edit(company_id,'tracking'));

-- unit_locations rows are written by the telematics-sync edge function using the
-- service role key (bypasses RLS). Manual/phone entries by staff:
drop policy if exists ul_manual_insert on unit_locations;
create policy ul_manual_insert on unit_locations for insert
  with check (source in ('manual','phone') and app.is_member(company_id));
