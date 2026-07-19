-- 015_cases.sql — repair case management (the Roadmark Fleet "Cases" workflow)
-- A case is a reported problem on a unit, tracked from report → diagnosis →
-- approval → repair → resolved, with comments and the shop invoice attached.

create table if not exists repair_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  case_number integer not null,
  title text not null,
  description text,
  unit_type text not null default 'truck' check (unit_type in ('truck','trailer')),
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  driver_id uuid references drivers(id) on delete set null,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status text not null default 'created' check (status in
    ('created','diagnostics','awaiting_approval','repair','resolved','closed','cancelled')),
  category text not null default 'other' check (category in
    ('engine','brakes','tires','electrical','refrigeration','aftertreatment','cooling',
     'suspension','transmission','body','trailer','pm_service','other')),
  vendor_id uuid references vendors(id) on delete set null,
  maintenance_invoice_id uuid references maintenance_invoices(id) on delete set null,
  assigned_to uuid references profiles(id),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  down_unit boolean not null default false,      -- truck can't run
  estimate_amount numeric(12,2),
  location_text text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id, case_number),
  check ((unit_type='truck' and truck_id is not null) or (unit_type='trailer' and trailer_id is not null))
);
create index if not exists idx_cases_company_status on repair_cases(company_id, status, priority);
create index if not exists idx_cases_truck on repair_cases(truck_id);

create table if not exists case_comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references repair_cases(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  body text not null,
  kind text not null default 'comment' check (kind in ('comment','status_change','attachment','system')),
  author_id uuid references profiles(id),
  author_label text,                    -- for bot/driver entries with no login
  created_at timestamptz not null default now()
);
create index if not exists idx_case_comments on case_comments(case_id, created_at);

-- case numbers per company, same pattern as loads
alter table companies add column if not exists next_case_number integer not null default 1;

create or replace function app.assign_case_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.case_number is null or new.case_number = 0 then
    update companies set next_case_number = next_case_number + 1
      where id = new.company_id
      returning next_case_number - 1 into new.case_number;
  end if;
  return new;
end $$;
drop trigger if exists trg_case_number on repair_cases;
create trigger trg_case_number before insert on repair_cases
  for each row execute function app.assign_case_number();

-- log every status change as a comment
create or replace function app.log_case_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into case_comments (case_id, company_id, body, kind, author_id)
    values (new.id, new.company_id,
            'Status changed to "' || replace(initcap(replace(new.status,'_',' ')), ' ', ' ') || '"',
            'status_change', auth.uid());
    if new.status in ('resolved','closed') and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_case_status on repair_cases;
create trigger trg_case_status before update on repair_cases
  for each row execute function app.log_case_status();

-- documents + extraction can point at a case
alter table documents drop constraint if exists documents_entity_type_check;
alter table documents add constraint documents_entity_type_check check (entity_type in
  ('load','driver','truck','trailer','maintenance_invoice','insurance_policy',
   'customer','employee','company','settlement','expense','repair_case','other'));

-- assistant actions / feeds can reference cases
alter table assistant_actions drop constraint if exists assistant_actions_kind_check;
alter table assistant_actions add constraint assistant_actions_kind_check check (kind in
  ('bol_loaded_notice','tracking_update','reminder','pti_alert','incident_alert',
   'delivered_notice','custom_email','case_opened','case_update'));

-- ---------------- RLS ----------------
alter table repair_cases enable row level security;
alter table case_comments enable row level security;

drop policy if exists cases_select on repair_cases;
create policy cases_select on repair_cases for select using (app.is_member(company_id));
drop policy if exists cases_write on repair_cases;
create policy cases_write on repair_cases for all
  using (app.can_edit(company_id,'maintenance') or app.can_edit(company_id,'fleet')
         or app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'safety'))
  with check (app.can_edit(company_id,'maintenance') or app.can_edit(company_id,'fleet')
         or app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'safety'));

drop policy if exists case_comments_select on case_comments;
create policy case_comments_select on case_comments for select using (app.is_member(company_id));
drop policy if exists case_comments_write on case_comments;
create policy case_comments_write on case_comments for insert
  with check (app.is_member(company_id));     -- anyone in the company can comment

-- realtime
do $$
begin
  begin execute 'alter publication supabase_realtime add table repair_cases'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table case_comments'; exception when duplicate_object then null; end;
end $$;

-- updated_at
drop trigger if exists trg_touch_repair_cases on repair_cases;
create trigger trg_touch_repair_cases before update on repair_cases
  for each row execute function app.touch_updated_at();
