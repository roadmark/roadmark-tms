-- 008_insurance.sql — insurance policies and enrollments

create table if not exists insurance_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_type text not null check (policy_type in
    ('auto_liability','cargo','physical_damage','general_liability','bobtail_ntl',
     'workers_comp','occupational_accident','trailer_interchange','other')),
  policy_number text not null,
  insurer text,
  status text not null default 'active' check (status in
    ('active','expired_soon','expired','cancelled')),
  start_date date,
  end_date date,
  pay_day smallint check (pay_day between 1 and 28),
  installment_amount numeric(12,2),
  coverage_basis text not null default 'per_unit' check (coverage_basis in ('per_unit','blanket')),
  premium_total numeric(12,2),
  coverage_limit numeric(14,2),
  deductible numeric(12,2),
  agent_name text,
  agent_phone text,
  agent_email text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_policies_company on insurance_policies(company_id, policy_type, status);

create table if not exists insurance_enrollments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references insurance_policies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('truck','trailer','driver')),
  truck_id uuid references trucks(id) on delete cascade,
  trailer_id uuid references trailers(id) on delete cascade,
  driver_id uuid references drivers(id) on delete cascade,
  added_date date not null default current_date,
  removed_date date,
  monthly_cost numeric(12,2),      -- feeds driver recurring deductions when driver-paid
  charged_to_driver boolean not null default false,
  created_at timestamptz not null default now(),
  check ((entity_type='truck' and truck_id is not null)
      or (entity_type='trailer' and trailer_id is not null)
      or (entity_type='driver' and driver_id is not null))
);
create index if not exists idx_enroll_policy on insurance_enrollments(policy_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['insurance_policies','insurance_enrollments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format($f$create policy %I_write on %I for all
      using (app.can_edit(company_id,'safety'))
      with check (app.can_edit(company_id,'safety'))$f$, t, t);
  end loop;
end $$;
