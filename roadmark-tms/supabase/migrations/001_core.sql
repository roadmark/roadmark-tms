-- 001_core.sql — Roadmark TMS core: companies, users, roles, RLS helpers, audit
-- Run first. All migrations are additive and idempotent where practical.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ============================================================ companies
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dba text,
  mc_number text,
  dot_number text,
  ein text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  logo_url text,
  active boolean not null default true,
  next_load_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================ profiles (auth users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ============================================================ memberships / roles
create table if not exists company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in
    ('master_admin','general_manager','manager','team_leader','member')),
  department text check (department in
    ('dispatch','accounting','safety','fleet','maintenance','tracking')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id),
  -- managers and team leaders must belong to a department
  check (role not in ('manager','team_leader') or department is not null)
);
create index if not exists idx_members_user on company_members(user_id);

-- ============================================================ RLS helper functions
create or replace function app.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_members m
    where m.company_id = cid and m.user_id = auth.uid() and m.status = 'active');
$$;

-- can the current user EDIT the given department's data?
-- master_admin / general_manager edit everything;
-- manager / team_leader edit only their own department.
create or replace function app.can_edit(cid uuid, dept text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_members m
    where m.company_id = cid and m.user_id = auth.uid() and m.status = 'active'
      and (m.role in ('master_admin','general_manager')
           or (m.role in ('manager','team_leader') and m.department = dept)));
$$;

-- admins = master_admin or general_manager
create or replace function app.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_members m
    where m.company_id = cid and m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('master_admin','general_manager'));
$$;

-- ============================================================ settings / audit / notifications
create table if not exists company_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('insert','update','delete')),
  changes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_log(entity_type, entity_id);
create index if not exists idx_audit_company_time on audit_log(company_id, created_at desc);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on notifications(user_id, read_at, created_at desc);

-- ============================================================ generic triggers
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function app.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  cid := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'company_id')::uuid
         else (to_jsonb(new)->>'company_id')::uuid end, null);
  insert into audit_log (company_id, user_id, entity_type, entity_id, action, changes)
  values (
    cid, auth.uid(), tg_table_name,
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'id')::uuid else (to_jsonb(new)->>'id')::uuid end,
    lower(tg_op),
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
         when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
         else jsonb_build_object('new', to_jsonb(new)) end);
  return coalesce(new, old);
end $$;

-- ============================================================ RLS
alter table companies enable row level security;
alter table profiles enable row level security;
alter table company_members enable row level security;
alter table company_settings enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;

-- companies: members can read; only owner role can update; creation via service role / owner UI
drop policy if exists companies_select on companies;
create policy companies_select on companies for select using (app.is_member(id));
drop policy if exists companies_update on companies;
create policy companies_update on companies for update using (app.is_admin(id));

-- profiles: any authenticated user can read basic profiles (needed for "created by" names);
-- users update only their own row
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (auth.uid() is not null);
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (id = auth.uid());

-- company_members: members see their company's roster; admins manage it
drop policy if exists members_select on company_members;
create policy members_select on company_members for select using (app.is_member(company_id));
drop policy if exists members_write on company_members;
create policy members_write on company_members for all
  using (app.is_admin(company_id)) with check (app.is_admin(company_id));

drop policy if exists settings_select on company_settings;
create policy settings_select on company_settings for select using (app.is_member(company_id));
drop policy if exists settings_write on company_settings;
create policy settings_write on company_settings for all
  using (app.is_admin(company_id)) with check (app.is_admin(company_id));

drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select using (app.is_admin(company_id));
-- audit rows are written by triggers (security definer) — no direct insert policy needed

drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update using (user_id = auth.uid());
