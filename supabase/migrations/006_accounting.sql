-- 006_accounting.sql — invoices, fuel, tolls, deductions, recurring deductions,
-- credits, balance due, escrow, business expenses

-- ============================================================ customer invoices
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  load_id uuid references loads(id) on delete set null,
  invoice_number text not null,
  invoice_date date not null default current_date,
  amount numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in
    ('draft','sent','factored','partial','paid','short_paid','over_paid','void')),
  factoring_report text,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);
create index if not exists idx_invoices_load on invoices(load_id);

create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  amount numeric(12,2) not null,
  short_pay numeric(12,2) not null default 0,
  over_pay numeric(12,2) not null default 0,
  method text,
  reference text,
  paid_at date not null default current_date,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================ fuel
create table if not exists fuel_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null default 'efs' check (provider in ('efs','comdata','fleet_one','wex','other')),
  card_number text not null,
  driver_id uuid references drivers(id),
  truck_id uuid references trucks(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, card_number)
);

create table if not exists fuel_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid references drivers(id),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  fuel_card_id uuid references fuel_cards(id),
  transaction_id text,
  card_number text,
  issued_date date not null,
  location text,
  city text,
  state text,
  product text not null default 'ULSD',   -- ULSD, DEFD, CADV (cash advance), RFR (reefer), OIL, ADD, other
  quantity numeric(10,2),
  amount numeric(12,2) not null default 0,
  fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  charge_to text not null default 'driver' check (charge_to in ('company','driver')),
  status text not null default 'open' check (status in ('open','closed','rejected')),
  settlement_id uuid,
  suggested_driver_id uuid references drivers(id),
  suggested_truck_id uuid references trucks(id),
  import_batch_id uuid references import_batches(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_fuel_driver_status on fuel_transactions(driver_id, status);
create index if not exists idx_fuel_company_date on fuel_transactions(company_id, issued_date desc);
create unique index if not exists uq_fuel_txn on fuel_transactions(company_id, transaction_id, issued_date)
  where transaction_id is not null;  -- dedupe re-imports

-- ============================================================ tolls
create table if not exists toll_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid references drivers(id),
  truck_id uuid references trucks(id),
  transaction_id text,
  tag_number text,
  license_plate text,
  plaza_name text,
  issued_date date not null,
  amount numeric(12,2) not null default 0,
  charge_to text not null default 'driver' check (charge_to in ('company','driver')),
  status text not null default 'open' check (status in ('open','closed','rejected')),
  settlement_id uuid,
  suggested_driver_id uuid references drivers(id),
  suggested_truck_id uuid references trucks(id),
  import_batch_id uuid references import_batches(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_toll_driver_status on toll_transactions(driver_id, status);
create unique index if not exists uq_toll_txn on toll_transactions(company_id, transaction_id, issued_date)
  where transaction_id is not null;

-- ============================================================ deductions (one-off, incl. installments)
create table if not exists deductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  issued_date date not null default current_date,
  charge_to text not null default 'driver' check (charge_to in ('company','driver')),
  category text not null default 'other' check (category in
    ('maintenance','efs','fuel','toll','drug_test','late_fee','missed_appointment',
     'registration','advance','escrow','damage','citation','other')),
  money_code text,
  description text,
  amount numeric(12,2) not null default 0,
  fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'open' check (status in ('open','closed','rejected')),
  settlement_id uuid,
  -- installments: "Total: $5703.85, Part 6/10"
  installment_group_id uuid,
  installment_part integer,
  installment_total integer,
  source_maintenance_invoice_id uuid references maintenance_invoices(id) on delete set null,
  load_id uuid references loads(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_deductions_driver_status on deductions(driver_id, status);
create index if not exists idx_deductions_company_date on deductions(company_id, issued_date desc);

-- ============================================================ recurring deductions
create table if not exists recurring_deductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  name text not null,                -- Truck rent, Trailer rent, ELD Device, Cargo insurance,
                                     -- Occupational insurance, Escrow, Bestpass Monthly ...
  amount numeric(12,2) not null,
  frequency text not null default 'weekly' check (frequency in ('weekly','biweekly','monthly')),
  anchor_dow smallint check (anchor_dow between 0 and 6),   -- weekly/biweekly: 1 = Monday
  anchor_dom smallint check (anchor_dom between 1 and 28),  -- monthly: day of month
  start_date date not null default current_date,
  end_date date,
  max_occurrences integer,           -- e.g. escrow 0/10
  occurrences_done integer not null default 0,
  is_escrow boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','stopped','completed')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recurring_driver on recurring_deductions(driver_id, status);

create table if not exists recurring_deduction_runs (
  id uuid primary key default gen_random_uuid(),
  recurring_deduction_id uuid not null references recurring_deductions(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  run_date date not null,
  period_start date,
  period_end date,
  amount numeric(12,2) not null,    -- may be prorated on first/last period
  status text not null default 'open' check (status in ('open','closed','rejected')),
  settlement_id uuid,
  created_at timestamptz not null default now(),
  unique (recurring_deduction_id, run_date)
);

-- ============================================================ credits / balance due / escrow
create table if not exists credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  issued_date date not null default current_date,
  category text not null default 'other' check (category in
    ('extra_miles','detention','layover','reimbursement','bonus','tonu_pay','other')),
  description text,
  amount numeric(12,2) not null,
  status text not null default 'open' check (status in ('open','closed','rejected')),
  settlement_id uuid,
  load_id uuid references loads(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists balance_dues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  issued_date date not null default current_date,
  description text,                 -- "Statement 2"
  amount numeric(12,2) not null,
  status text not null default 'open' check (status in ('open','closed','rejected')),
  source_settlement_id uuid,
  applied_settlement_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists escrow_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  target_amount numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, driver_id)
);

create table if not exists escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  escrow_account_id uuid not null references escrow_accounts(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  amount numeric(12,2) not null,        -- + contribution, - withdrawal/refund
  kind text not null check (kind in ('contribution','withdrawal','refund','adjustment')),
  settlement_id uuid,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================ business expenses (non-driver)
create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  unique (company_id, name)
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category_id uuid references expense_categories(id),
  vendor text,
  description text,
  amount numeric(12,2) not null,
  expense_date date not null default current_date,
  payment_method text check (payment_method in ('bank','credit_card','cash','check','other')),
  truck_id uuid references trucks(id),
  trailer_id uuid references trailers(id),
  recurring boolean not null default false,
  document_id uuid references documents(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_expenses_company_date on expenses(company_id, expense_date desc);

-- ============================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_payments','fuel_cards','fuel_transactions',
    'toll_transactions','deductions','recurring_deductions','recurring_deduction_runs',
    'credits','balance_dues','escrow_accounts','escrow_transactions',
    'expense_categories','expenses']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format($f$create policy %I_write on %I for all
      using (app.can_edit(company_id,'accounting'))
      with check (app.can_edit(company_id,'accounting'))$f$, t, t);
  end loop;
end $$;

-- maintenance dept can create deductions sourced from repair invoices
drop policy if exists deductions_maintenance on deductions;
create policy deductions_maintenance on deductions for insert
  with check (app.can_edit(company_id,'maintenance')
              and source_maintenance_invoice_id is not null);
