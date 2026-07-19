-- 011_assistants.sql — department assistants: email threads, tracking updates,
-- Telegram groups/bots, reminders, PTI analysis, incident (accident) reports

-- ============================================================ connected mailboxes
create table if not exists email_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null check (provider in ('gmail','microsoft','smtp_imap')),
  address text not null,               -- dispatch@yourcompany.com
  display_name text,
  secret_ref text not null,            -- OAuth refresh token / SMTP creds stored as
                                       -- edge secret EMAIL_CREDS_{secret_ref}, never in DB
  status text not null default 'active' check (status in ('active','error','disabled')),
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, address)
);

-- one row per broker email conversation linked to a load
create table if not exists email_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  mailbox_id uuid not null references email_mailboxes(id) on delete cascade,
  load_id uuid references loads(id) on delete set null,
  provider_thread_id text,             -- Gmail threadId / Graph conversationId
  subject text,
  participants jsonb not null default '[]'::jsonb,  -- [{email,name,role:'to'|'cc'}]
  last_message_rfc_id text,            -- RFC 5322 Message-ID of newest message
  references_chain text,               -- accumulated References header
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, provider_thread_id)
);
create index if not exists idx_email_threads_load on email_threads(load_id);

-- ============================================================ dispatcher message templates
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  owner_id uuid references profiles(id),    -- NULL = company default
  kind text not null check (kind in
    ('loaded_notice','tracking_update','delivered_notice','delay_notice','custom')),
  name text not null,
  subject text,
  body text not null,   -- placeholders: {load_number} {customer_load_id} {truck} {driver_first_name}
                        -- {location} {eta} {next_stop_city} {appointment_time} {temperature}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================ automated location updates per load
create table if not exists tracking_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  load_id uuid not null references loads(id) on delete cascade,
  email_thread_id uuid references email_threads(id) on delete set null,
  enabled boolean not null default true,
  interval_minutes integer not null default 60,
  extra_recipients jsonb not null default '[]'::jsonb,   -- broker tracking dept emails to add
  template_id uuid references message_templates(id),
  quiet_start time,                    -- e.g. 22:00 — no emails overnight (optional)
  quiet_end time,                      -- e.g. 06:00
  started_at timestamptz,              -- set when load hits in_progress (pickup done)
  last_sent_at timestamptz,
  next_send_at timestamptz,
  stopped_at timestamptz,              -- set on delivered/cancelled or manual stop
  stop_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (load_id)
);
create index if not exists idx_tracking_due on tracking_subscriptions(enabled, next_send_at);

-- ============================================================ Telegram wiring
create table if not exists telegram_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  chat_id bigint not null,             -- Telegram group chat id
  title text,                          -- group title, e.g. "4114"
  truck_id uuid references trucks(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id)
);
create index if not exists idx_tg_groups_truck on telegram_groups(truck_id);

create table if not exists telegram_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  telegram_user_id bigint not null,
  username text,                       -- @handle for tagging
  display_name text,
  driver_id uuid references drivers(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, telegram_user_id)
);

-- every bot action that needs (or had) a human decision, plus a log of what was sent
create table if not exists assistant_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in
    ('bol_loaded_notice','tracking_update','reminder','pti_alert','incident_alert',
     'delivered_notice','custom_email')),
  status text not null default 'pending' check (status in
    ('pending','awaiting_approval','approved','rejected','sent','failed','expired')),
  load_id uuid references loads(id) on delete set null,
  truck_id uuid references trucks(id) on delete set null,
  driver_id uuid references drivers(id) on delete set null,
  telegram_chat_id bigint,
  telegram_message_id bigint,          -- the approval prompt message (for editing after click)
  extraction_job_id uuid references extraction_jobs(id) on delete set null,
  email_thread_id uuid references email_threads(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,   -- parsed BOL fields, composed email, etc.
  approved_by uuid references profiles(id),
  decided_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_actions_status on assistant_actions(company_id, status, created_at desc);

-- ============================================================ reminders
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'manual' check (kind in
    ('manual','appointment','compliance','pm_service','insurance','custom_recurring')),
  title text not null,
  body text,
  due_at timestamptz not null,
  recurrence text check (recurrence in ('none','daily','weekly','monthly')),
  telegram_chat_id bigint,             -- where to post (truck group), NULL = in-app only
  mention_departments jsonb not null default '[]'::jsonb, -- ["dispatch","safety","maintenance"]
  mention_driver boolean not null default false,
  entity_type text,                    -- load / truck / driver / compliance_item / pm_schedule
  entity_id uuid,
  load_id uuid references loads(id) on delete cascade,
  truck_id uuid references trucks(id) on delete cascade,
  driver_id uuid references drivers(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled','sent','done','cancelled')),
  sent_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reminders_due on reminders(status, due_at);

-- ============================================================ PTI (pre-trip inspection) analysis
create table if not exists pti_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  driver_id uuid references drivers(id) on delete set null,
  telegram_chat_id bigint,
  image_paths jsonb not null default '[]'::jsonb,   -- storage paths of the PTI photos
  analysis jsonb,                       -- full model output per image
  violations jsonb not null default '[]'::jsonb,
  -- [{code:'tire_tread', label:'Possible bald/worn tire', severity:'out_of_service'|'violation'|'warn',
  --   confidence:0.8, image_index:2}]
  result text not null default 'pending' check (result in
    ('pending','pass','flagged','failed_analysis')),
  reviewed_by uuid references profiles(id),
  review_note text,
  maintenance_invoice_id uuid references maintenance_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pti_truck on pti_inspections(truck_id, created_at desc);

-- ============================================================ incidents (accident detection)
create table if not exists incident_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source text not null default 'telegram' check (source in ('telegram','manual','phone')),
  telegram_chat_id bigint,
  telegram_message_id bigint,
  reported_text text,                   -- the driver's message, verbatim
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references trucks(id) on delete set null,
  trailer_id uuid references trailers(id) on delete set null,
  load_id uuid references loads(id) on delete set null,
  lat double precision,
  lng double precision,
  severity text not null default 'unknown' check (severity in
    ('unknown','minor','major','injury','fatality','hazmat')),
  status text not null default 'open' check (status in
    ('open','acknowledged','handling','closed','false_alarm')),
  acknowledged_by uuid references profiles(id),
  acknowledged_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_incidents_status on incident_reports(company_id, status, created_at desc);

-- ============================================================ extend extraction kinds (additive)
alter table extraction_jobs drop constraint if exists extraction_jobs_kind_check;
alter table extraction_jobs add constraint extraction_jobs_kind_check check (kind in
  ('rate_confirmation','repair_invoice','fuel_statement','toll_statement',
   'insurance_policy','driver_document','bol','pti_images','other'));

-- extend documents entity/doc types used by assistants (additive)
alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check check (doc_type in
  ('rate_con','pod','bol','lumper','invoice','receipt','coi','cdl','medical_card',
   'w9','contract','statement','photo','registration','inspection','permit',
   'pti_photo','incident_photo','other'));

-- ============================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['email_mailboxes','email_threads','message_templates',
    'tracking_subscriptions','telegram_groups','telegram_identities','assistant_actions',
    'reminders','pti_inspections','incident_reports']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
  end loop;
end $$;

-- who edits what
create policy email_mailboxes_write on email_mailboxes for all
  using (app.is_admin(company_id)) with check (app.is_admin(company_id));
create policy email_threads_write on email_threads for all
  using (app.can_edit(company_id,'dispatch')) with check (app.can_edit(company_id,'dispatch'));
create policy message_templates_write on message_templates for all
  using (app.can_edit(company_id,'dispatch')) with check (app.can_edit(company_id,'dispatch'));
create policy tracking_subscriptions_write on tracking_subscriptions for all
  using (app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'tracking'))
  with check (app.can_edit(company_id,'dispatch') or app.can_edit(company_id,'tracking'));
create policy telegram_groups_write on telegram_groups for all
  using (app.is_admin(company_id) or app.can_edit(company_id,'dispatch'))
  with check (app.is_admin(company_id) or app.can_edit(company_id,'dispatch'));
create policy telegram_identities_write on telegram_identities for all
  using (app.is_admin(company_id) or app.can_edit(company_id,'safety'))
  with check (app.is_admin(company_id) or app.can_edit(company_id,'safety'));
create policy assistant_actions_write on assistant_actions for all
  using (app.can_edit(company_id,'dispatch')) with check (app.can_edit(company_id,'dispatch'));
create policy reminders_write on reminders for all
  using (app.is_member(company_id)) with check (app.is_member(company_id));  -- anyone can set reminders
create policy pti_write on pti_inspections for all
  using (app.can_edit(company_id,'safety') or app.can_edit(company_id,'maintenance'))
  with check (app.can_edit(company_id,'safety') or app.can_edit(company_id,'maintenance'));
create policy incidents_write on incident_reports for all
  using (app.can_edit(company_id,'safety') or app.can_edit(company_id,'dispatch'))
  with check (app.can_edit(company_id,'safety') or app.can_edit(company_id,'dispatch'));

-- bots write via service role (edge functions), which bypasses RLS.

-- ============================================================ realtime for approval flows
do $$
declare t text;
begin
  foreach t in array array['assistant_actions','reminders','pti_inspections','incident_reports',
                           'tracking_subscriptions','email_threads']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
