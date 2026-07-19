-- 013_email.sql — mailbox credentials + thread linking helpers
-- Run in the Supabase SQL Editor after 012.

-- OAuth tokens live in their own table with RLS ON and NO policies:
-- nothing using the anon/authenticated key can ever read it. Only edge functions
-- (service role, which bypasses RLS) can. The browser never sees a token.
create table if not exists email_credentials (
  mailbox_id uuid primary key references email_mailboxes(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table email_credentials enable row level security;
-- deliberately no policies

-- a couple of conveniences on the mailbox row
alter table email_mailboxes add column if not exists connected_at timestamptz;
alter table email_mailboxes add column if not exists history_id text;

-- threads: remember the snippet so dispatch can recognise the conversation
alter table email_threads add column if not exists snippet text;
alter table email_threads add column if not exists auto_linked boolean not null default false;

-- what the assistant sent, per load, is already in assistant_actions.

-- seed a default "we are loaded" and "tracking update" template per company
insert into message_templates (company_id, kind, name, subject, body)
select c.id, 'loaded_notice', 'Loaded notice (default)',
  'Loaded — {customer_load_id}',
  'Hello,' || chr(10) || chr(10) ||
  'Truck {truck} is loaded and rolling on {customer_load_id}.' || chr(10) ||
  'Delivery: {next_stop_city} — appointment {appointment_time}.' || chr(10) ||
  'BOL is attached. We will send location updates until delivery.' || chr(10) || chr(10) ||
  'Thank you,' || chr(10) || '{company} Dispatch'
from companies c
where not exists (
  select 1 from message_templates m where m.company_id = c.id and m.kind = 'loaded_notice');

insert into message_templates (company_id, kind, name, subject, body)
select c.id, 'tracking_update', 'Tracking update (default)',
  'Update — {customer_load_id}',
  'Location update for {customer_load_id}:' || chr(10) || chr(10) ||
  'Truck {truck} is currently near {location}.' || chr(10) ||
  'Next stop: {next_stop_city}. ETA {eta}.' || chr(10) || chr(10) ||
  '{company} Dispatch'
from companies c
where not exists (
  select 1 from message_templates m where m.company_id = c.id and m.kind = 'tracking_update');
