-- 007_settlements_payroll.sql — driver settlements + office payroll

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  statement_number integer not null,
  period_start date not null,
  period_end date not null,
  cutoff_date date not null,
  status text not null default 'draft' check (status in ('draft','review','approved','paid','void')),
  loads_total numeric(12,2) not null default 0,
  credits_total numeric(12,2) not null default 0,
  fuel_total numeric(12,2) not null default 0,
  tolls_total numeric(12,2) not null default 0,
  deductions_total numeric(12,2) not null default 0,
  scheduled_total numeric(12,2) not null default 0,
  balance_forward numeric(12,2) not null default 0,
  escrow_total numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  paid_at date,
  payment_method text,
  payment_ref text,
  pdf_document_id uuid references documents(id) on delete set null,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, driver_id, statement_number)
);
create index if not exists idx_settlements_driver on settlements(driver_id, period_end desc);
create index if not exists idx_settlements_company on settlements(company_id, status, cutoff_date desc);

create table if not exists settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  line_type text not null check (line_type in
    ('load','credit','fuel','toll','deduction','scheduled_deduction',
     'balance_forward','escrow','adjustment')),
  ref_table text,
  ref_id uuid,
  description text,
  amount numeric(12,2) not null,  -- signed: loads/credits positive, deductions negative
  created_at timestamptz not null default now()
);
create index if not exists idx_slines_settlement on settlement_lines(settlement_id);

-- late FKs: settlement stamps on source tables
alter table loads
  drop constraint if exists loads_settlement_fk,
  add constraint loads_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table fuel_transactions
  drop constraint if exists fuel_settlement_fk,
  add constraint fuel_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table toll_transactions
  drop constraint if exists toll_settlement_fk,
  add constraint toll_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table deductions
  drop constraint if exists deductions_settlement_fk,
  add constraint deductions_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table recurring_deduction_runs
  drop constraint if exists rdr_settlement_fk,
  add constraint rdr_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table credits
  drop constraint if exists credits_settlement_fk,
  add constraint credits_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;
alter table balance_dues
  drop constraint if exists bd_source_fk,
  add constraint bd_source_fk foreign key (source_settlement_id)
  references settlements(id) on delete set null,
  drop constraint if exists bd_applied_fk,
  add constraint bd_applied_fk foreign key (applied_settlement_id)
  references settlements(id) on delete set null;
alter table escrow_transactions
  drop constraint if exists escrow_settlement_fk,
  add constraint escrow_settlement_fk foreign key (settlement_id)
  references settlements(id) on delete set null;

-- ============================================================ office payroll
create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','review','approved','paid','void')),
  total_gross numeric(12,2) not null default 0,
  total_net numeric(12,2) not null default 0,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id),
  base_amount numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  deduction numeric(12,2) not null default 0,
  reimbursement numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,
  paid_at date,
  payment_method text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_payroll_lines_run on payroll_lines(payroll_run_id);

-- ============================================================ RLS (accounting-only)
do $$
declare t text;
begin
  foreach t in array array['settlements','settlement_lines','payroll_runs','payroll_lines']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format($f$create policy %I_all on %I for all
      using (app.can_edit(company_id,'accounting'))
      with check (app.can_edit(company_id,'accounting'))$f$, t, t);
  end loop;
end $$;
