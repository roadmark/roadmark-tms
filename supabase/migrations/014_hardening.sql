-- 014_hardening.sql — production hardening support
-- Run in the Supabase SQL Editor after 013.

-- Telegram sends photos one update at a time; a "media group" is how it marks
-- several photos posted together. Storing it lets one PTI batch be analysed in a
-- single AI call instead of one call per photo.
alter table pti_inspections add column if not exists media_group_id text;
create index if not exists idx_pti_media_group on pti_inspections(media_group_id)
  where media_group_id is not null;

-- Guard against Telegram re-delivering the same update (it retries on timeout).
create table if not exists telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
alter table telegram_updates enable row level security;
-- no policies: only edge functions (service role) touch this

-- keep it small
create or replace function app.prune_telegram_updates() returns void
language sql security definer set search_path = public as $$
  delete from telegram_updates where received_at < now() - interval '2 days';
$$;

select cron.schedule('prune-telegram-updates', '20 4 * * *',
  $$select app.prune_telegram_updates()$$);
