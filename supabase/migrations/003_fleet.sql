-- 003_fleet.sql — trucks, trailers, assignments, vendors, maintenance, PM

create table if not exists trucks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_number text not null,
  vin text,
  make text,
  model text,
  year integer,
  truck_type text not null default 'semi_truck' check (truck_type in ('semi_truck','box_truck')),
  ownership text not null default 'company' check (ownership in ('company','owner','rent','lease_to_buy')),
  status text not null default 'active' check (status in
    ('active','pending','unusable','ready','recovery','shop','not_used',
     'crash','for_shop','for_check','rented','terminated')),
  leasor text,
  plate text,
  plate_state text,
  registrant text,
  toll_device_code text,
  dropoff_location text,
  dropoff_note text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id, unit_number)
);
create index if not exists idx_trucks_vin on trucks(vin);
create index if not exists idx_trucks_status on trucks(company_id, status);

create table if not exists trailers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_number text not null,
  vin text,
  make text,
  model text,
  year integer,
  trailer_type text not null default 'dry_van' check (trailer_type in
    ('dry_van','reefer','flatbed','box','power_only','other')),
  ownership text not null default 'company' check (ownership in ('company','owner','rent','lease_to_buy')),
  status text not null default 'active' check (status in
    ('active','pending','unusable','ready','recovery','shop','not_used',
     'crash','for_shop','for_check','rented','terminated')),
  leasor text,
  plate text,
  plate_state text,
  registrant text,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id, unit_number)
);
create index if not exists idx_trailers_vin on trailers(vin);

create table if not exists unit_leases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_type text not null check (unit_type in ('truck','trailer')),
  truck_id uuid references trucks(id) on delete cascade,
  trailer_id uuid references trailers(id) on delete cascade,
  leasor text,
  lease_number text,
  start_date date,
  end_date date,
  down_payment numeric(12,2),
  weekly_payment numeric(12,2),
  buyout_amount numeric(12,2),
  prior_payments numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  check ((unit_type='truck' and truck_id is not null and trailer_id is null)
      or (unit_type='trailer' and trailer_id is not null and truck_id is null))
);

-- ============================================================ assignments (time-ranged history)
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,             -- NULL = current assignment
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
-- one ACTIVE assignment per driver / per truck / per trailer
create unique index if not exists uq_active_driver on assignments(driver_id) where ended_at is null and driver_id is not null;
create unique index if not exists uq_active_truck on assignments(truck_id) where ended_at is null and truck_id is not null;
create unique index if not exists uq_active_trailer on assignments(trailer_id) where ended_at is null and trailer_id is not null;

-- ============================================================ vendors + maintenance
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  city text,
  state text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_number text,
  unit_type text not null check (unit_type in ('truck','trailer')),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  driver_id uuid references drivers(id),   -- driver at time of repair
  vendor_id uuid references vendors(id),
  in_date date,
  out_date date,
  payment_type text check (payment_type in ('bank','credit_card','cash','efs','check','other')),
  payment_ref text,                        -- EFS money code / check no / acct label
  status text not null default 'in_progress' check (status in
    ('in_progress','to_be_paid','check','on_hold','paid','rejected')),
  odometer integer,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  fees numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  on_company_total numeric(12,2) not null default 0,
  on_driver_total numeric(12,2) not null default 0,
  driver_fee_pct numeric(6,4) not null default 0,  -- admin fee added on driver-charged portions
  extraction_job_id uuid,                  -- fk added in 005
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  check ((unit_type='truck' and truck_id is not null) or (unit_type='trailer' and trailer_id is not null))
);
create index if not exists idx_maint_company_date on maintenance_invoices(company_id, in_date desc);

create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references maintenance_invoices(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  description text not null,
  category text,               -- tires, brakes, engine, electrical, pm_service, body, other
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  charge_to text not null default 'company' check (charge_to in ('company','driver')),
  created_at timestamptz not null default now()
);

-- ============================================================ PM schedules + odometers
create table if not exists pm_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_type text not null check (unit_type in ('truck','trailer')),
  truck_id uuid references trucks(id) on delete cascade,
  trailer_id uuid references trailers(id) on delete cascade,
  name text not null,          -- 'PM Service', 'DOT Inspection', 'Oil Change'
  kind text not null default 'pm' check (kind in ('pm','dot','other')),
  interval_miles integer,
  interval_days integer,
  last_done_date date,
  last_done_odometer integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((unit_type='truck' and truck_id is not null) or (unit_type='trailer' and trailer_id is not null))
);

create table if not exists odometer_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  truck_id uuid not null references trucks(id) on delete cascade,
  reading integer not null,
  source text not null default 'manual' check (source in ('manual','eld','invoice')),
  recorded_at timestamptz not null default now()
);
create index if not exists idx_odo_truck_time on odometer_readings(truck_id, recorded_at desc);

-- ============================================================ RLS
do $$
declare t text;
begin
  -- everyone in the company can VIEW; only the owning department (or admins) can EDIT
  foreach t in array array['trucks','trailers','unit_leases','assignments','vendors',
                           'maintenance_invoices','maintenance_tasks','pm_schedules','odometer_readings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
  end loop;

  -- FLEET department: units, leases, assignments
  foreach t in array array['trucks','trailers','unit_leases','assignments']
  loop
    execute format($f$create policy %I_write on %I for all
      using (app.can_edit(company_id,'fleet'))
      with check (app.can_edit(company_id,'fleet'))$f$, t, t);
  end loop;

  -- MAINTENANCE department: vendors, invoices, tasks, PM, odometers
  foreach t in array array['vendors','maintenance_invoices','maintenance_tasks',
                           'pm_schedules','odometer_readings']
  loop
    execute format($f$create policy %I_write on %I for all
      using (app.can_edit(company_id,'maintenance'))
      with check (app.can_edit(company_id,'maintenance'))$f$, t, t);
  end loop;
end $$;

-- dispatch can also manage assignments (they swap trucks/trailers daily)
drop policy if exists assignments_dispatch on assignments;
create policy assignments_dispatch on assignments for all
  using (app.can_edit(company_id,'dispatch'))
  with check (app.can_edit(company_id,'dispatch'));
