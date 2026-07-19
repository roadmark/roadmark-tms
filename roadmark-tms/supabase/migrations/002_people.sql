-- 002_people.sql — drivers, employees (office staff), compliance catalog

-- ============================================================ payment groups
create table if not exists payment_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  cutoff_dow smallint not null default 0 check (cutoff_dow between 0 and 6), -- 0=Sunday
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- ============================================================ drivers
create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  driver_type text not null default 'company' check (driver_type in
    ('company','owner','rent','lease_to_buy','contractor')),
  status text not null default 'applicant' check (status in
    ('active','at_leave','applicant','ex_applicant','approved','ready','rejected','terminated')),
  ssn text, -- duplicated identity key for cross-company grouping; full PII in driver_private
  cdl_number text,
  cdl_class text,
  cdl_state text,
  cdl_endorsements text,
  company_name text,          -- driver's own LLC (owner-ops / contractors)
  company_ein text,
  company_address text,
  dispatcher_id uuid references profiles(id),
  co_driver_id uuid references drivers(id),
  payment_group_id uuid references payment_groups(id),
  recruiter text,
  -- pay configuration (snapshot copied onto each load at assignment time)
  pay_rate_type text not null default 'percentage' check (pay_rate_type in
    ('percentage','per_total_mile','per_loaded_mile','flat')),
  pay_rate numeric(8,4) not null default 0,   -- 0.88 = 88%  |  0.65 = $/mi  |  flat $
  deduct_fuel boolean not null default true,
  deduct_tolls boolean not null default true,
  fuel_discount_pct numeric(6,4) not null default 0, -- share of fuel discount passed to driver
  emergency_contact_name text,
  emergency_contact_phone text,
  hire_date date,
  termination_date date,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drivers_company on drivers(company_id, status);
create index if not exists idx_drivers_ssn on drivers(ssn);

create table if not exists driver_private (
  driver_id uuid primary key references drivers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  ssn_full text,
  date_of_birth date,
  home_address text,
  bank_routing text,
  bank_account text,
  payout_method text check (payout_method in ('direct_deposit','check','zelle','wire','cash','other')),
  updated_at timestamptz not null default now()
);

-- ============================================================ employees (office staff)
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid references profiles(id),     -- link to their login, if they have one
  full_name text not null,
  email text,
  phone text,
  department text not null check (department in
    ('dispatch','accounting','safety','fleet','maintenance','tracking','admin','other')),
  position text,
  status text not null default 'active' check (status in ('active','at_leave','terminated')),
  salary_type text not null default 'monthly' check (salary_type in
    ('monthly','weekly','biweekly','hourly','per_load','percentage')),
  salary_amount numeric(12,2) not null default 0,
  salary_notes text,       -- e.g. "1% of gross of covered drivers"
  hire_date date,
  termination_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employees_private (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  ssn_full text,
  date_of_birth date,
  home_address text,
  bank_routing text,
  bank_account text,
  updated_at timestamptz not null default now()
);

-- ============================================================ compliance
create table if not exists compliance_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade, -- NULL = global default
  code text not null,          -- APL, CDL, CH, DDAF, DT, ICA, MED, MVR, PSP, W9, INSP, REG, HUT2290...
  name text not null,
  applies_to text not null check (applies_to in ('driver','truck','trailer','company')),
  mandatory boolean not null default true,
  default_valid_days integer,  -- e.g. MED = 730
  created_at timestamptz not null default now()
);

create table if not exists compliance_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  compliance_type_id uuid not null references compliance_types(id),
  entity_type text not null check (entity_type in ('driver','truck','trailer','company')),
  entity_id uuid not null,
  status text not null default 'missing' check (status in ('valid','expiring','expired','missing','waived')),
  issue_date date,
  expiry_date date,
  document_id uuid,            -- fk added in 005 after documents exists
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_compliance_entity on compliance_items(entity_type, entity_id);
create index if not exists idx_compliance_expiry on compliance_items(company_id, expiry_date);

-- ============================================================ RLS
alter table payment_groups enable row level security;
alter table drivers enable row level security;
alter table driver_private enable row level security;
alter table employees enable row level security;
alter table employees_private enable row level security;
alter table compliance_types enable row level security;
alter table compliance_items enable row level security;

-- broad read for members, writes restricted per role
drop policy if exists drivers_select on drivers;
create policy drivers_select on drivers for select using (app.is_member(company_id));
drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all
  using ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'accounting')));

drop policy if exists driver_private_all on driver_private;
create policy driver_private_all on driver_private for all
  using ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'accounting')))
  with check ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'accounting')));

drop policy if exists employees_select on employees;
create policy employees_select on employees for select
  using (app.can_edit(company_id,'accounting'));
drop policy if exists employees_write on employees;
create policy employees_write on employees for all
  using (app.can_edit(company_id,'accounting'))
  with check (app.can_edit(company_id,'accounting'));

drop policy if exists employees_private_all on employees_private;
create policy employees_private_all on employees_private for all
  using (app.can_edit(company_id,'accounting'))
  with check (app.can_edit(company_id,'accounting'));

drop policy if exists pg_select on payment_groups;
create policy pg_select on payment_groups for select using (app.is_member(company_id));
drop policy if exists pg_write on payment_groups;
create policy pg_write on payment_groups for all
  using (app.can_edit(company_id,'accounting'))
  with check (app.can_edit(company_id,'accounting'));

drop policy if exists ct_select on compliance_types;
create policy ct_select on compliance_types for select
  using (company_id is null or app.is_member(company_id));
drop policy if exists ct_write on compliance_types;
create policy ct_write on compliance_types for all
  using (company_id is not null and app.can_edit(company_id,'safety'))
  with check (company_id is not null and app.can_edit(company_id,'safety'));

drop policy if exists ci_select on compliance_items;
create policy ci_select on compliance_items for select using (app.is_member(company_id));
drop policy if exists ci_write on compliance_items;
create policy ci_write on compliance_items for all
  using ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'fleet')))
  with check ((app.can_edit(company_id,'safety') or app.can_edit(company_id,'fleet')));

-- ============================================================ seed global compliance defaults
insert into compliance_types (company_id, code, name, applies_to, mandatory, default_valid_days)
select null, v.code, v.name, v.applies_to, v.mandatory, v.days
from (values
  ('APL','Application','driver',true,null),
  ('CDL','CDL License','driver',true,null),
  ('CH','Clearing House','driver',true,365),
  ('DDAF','Direct Deposit Auth Form','driver',false,null),
  ('DT','Drug Test','driver',true,365),
  ('ICA','Independent Contractor Agreement','driver',true,null),
  ('MED','Medical Card','driver',true,730),
  ('MVR','Motor Vehicle Record','driver',true,365),
  ('PSP','PSP Report','driver',true,null),
  ('W9','W-9','driver',true,null),
  ('INSP','Annual Inspection','truck',true,365),
  ('REG','Registration','truck',true,365),
  ('HUT2290','Heavy Use Tax 2290','truck',true,365),
  ('TINSP','Annual Inspection','trailer',true,365),
  ('TREG','Registration','trailer',true,365)
) as v(code,name,applies_to,mandatory,days)
where not exists (select 1 from compliance_types where company_id is null and code = v.code and applies_to = v.applies_to);
