-- 004_dispatch.sql — customers, loads, stops, status history, track & trace

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  mc_number text,
  dot_number text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  billing_email text,
  payment_terms_days integer default 30,
  factoring boolean not null default true,   -- invoices go through factoring by default
  status text not null default 'active' check (status in ('active','on_hold','do_not_use')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_name on customers(company_id, name);

create table if not exists customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text,
  created_at timestamptz not null default now()
);

-- ============================================================ loads
create table if not exists loads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  load_number integer not null,                 -- auto per company (trigger below)
  status text not null default 'scheduled' check (status in
    ('scheduled','in_progress','delivered','cancelled','tonu',
     'invoiced','payment_pending','completed')),
  customer_id uuid references customers(id),
  customer_load_id text,                        -- broker's reference / PRO number
  dispatcher_id uuid references profiles(id),
  driver_id uuid references drivers(id),
  co_driver_id uuid references drivers(id),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  -- denormalized from first pickup / last delivery stop for fast tables
  pickup_time timestamptz,
  delivery_time timestamptz,
  pickup_location text,                         -- "Circleville, OH"
  delivery_location text,                       -- "Orlando, FL (+2)"
  loaded_miles integer not null default 0,
  empty_miles integer not null default 0,
  total_miles integer generated always as (loaded_miles + empty_miles) stored,
  freight_amount numeric(12,2) not null default 0,   -- what the customer pays
  driver_rate numeric(12,2) not null default 0,      -- what the driver earns on this load
  weight_lbs integer,
  commodity text,
  temperature text,                              -- reefer setpoint if any
  -- driver pay snapshot at assignment time
  driver_pay_type text check (driver_pay_type in ('percentage','per_total_mile','per_loaded_mile','flat')),
  driver_pay_rate numeric(8,4),
  settlement_id uuid,                            -- stamped when settled (fk added in 007)
  notes text,
  accounting_note text,
  tonu boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id, load_number)
);
create index if not exists idx_loads_company_status on loads(company_id, status);
create index if not exists idx_loads_driver on loads(driver_id, pickup_time desc);
create index if not exists idx_loads_dispatcher on loads(dispatcher_id, pickup_time desc);
create index if not exists idx_loads_customer on loads(customer_id);
create index if not exists idx_loads_pickup_time on loads(company_id, pickup_time desc);

-- auto load number per company (atomic counter on companies.next_load_number)
create or replace function app.assign_load_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.load_number is null or new.load_number = 0 then
    update companies set next_load_number = next_load_number + 1
      where id = new.company_id
      returning next_load_number - 1 into new.load_number;
  end if;
  return new;
end $$;

drop trigger if exists trg_load_number on loads;
create trigger trg_load_number before insert on loads
  for each row execute function app.assign_load_number();

-- ============================================================ stops (multi pickup/delivery)
create table if not exists load_stops (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  seq integer not null default 1,
  stop_type text not null check (stop_type in ('pickup','delivery')),
  location_name text,
  address text,
  city text,
  state text,
  zip text,
  appointment_type text not null default 'appt' check (appointment_type in ('appt','fcfs')),
  scheduled_at timestamptz,
  scheduled_end timestamptz,        -- FCFS window end
  arrived_at timestamptz,
  departed_at timestamptz,
  reference_numbers text,           -- PU# / delivery confirmation numbers
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_stops_load on load_stops(load_id, seq);

-- keep the loads denorm fields in sync with stops
create or replace function app.sync_load_stop_denorm() returns trigger
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  lid := coalesce(new.load_id, old.load_id);
  update loads l set
    pickup_time = fs.scheduled_at,
    pickup_location = coalesce(fs.city || ', ' || fs.state, fs.location_name),
    delivery_time = ls.scheduled_at,
    delivery_location = coalesce(ls.city || ', ' || ls.state, ls.location_name)
      || case when dcount.n > 1 then ' (+' || (dcount.n - 1) || ')' else '' end
  from
    (select * from load_stops where load_id = lid and stop_type='pickup' order by seq limit 1) fs,
    (select * from load_stops where load_id = lid and stop_type='delivery' order by seq desc limit 1) ls,
    (select count(*) n from load_stops where load_id = lid and stop_type='delivery') dcount
  where l.id = lid;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_stops_denorm on load_stops;
create trigger trg_stops_denorm after insert or update or delete on load_stops
  for each row execute function app.sync_load_stop_denorm();

-- ============================================================ status history + check calls
create table if not exists load_status_history (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_lsh_load on load_status_history(load_id, changed_at);

create or replace function app.log_load_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into load_status_history (load_id, company_id, from_status, to_status, changed_by)
    values (new.id, new.company_id, old.status, new.status, auth.uid());
  elsif tg_op = 'INSERT' then
    insert into load_status_history (load_id, company_id, from_status, to_status, changed_by)
    values (new.id, new.company_id, null, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_load_status on loads;
create trigger trg_load_status after insert or update on loads
  for each row execute function app.log_load_status();

create table if not exists check_calls (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  lat double precision,
  lng double precision,
  location_text text,
  eta timestamptz,
  temperature text,
  note text,
  source text not null default 'manual' check (source in ('manual','phone','eld')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_checkcalls_load on check_calls(load_id, created_at desc);

-- ============================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['customers','customer_contacts','loads','load_stops',
                           'load_status_history','check_calls']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
  end loop;
end $$;

drop policy if exists customers_write on customers;
create policy customers_write on customers for all
  using ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')));

drop policy if exists cc_write on customer_contacts;
create policy cc_write on customer_contacts for all
  using ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')));

drop policy if exists loads_write on loads;
create policy loads_write on loads for all
  using ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')));
-- NOTE: finer money-field restrictions are enforced in the UI/permissions.js layer;
-- if you want DB-hard enforcement later, split money columns behind an update trigger.

drop policy if exists stops_write on load_stops;
create policy stops_write on load_stops for all
  using ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'accounting')));

drop policy if exists checkcalls_write on check_calls;
create policy checkcalls_write on check_calls for insert
  with check ((app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'tracking')));
