-- 012_department_feed.sql — every assistant/bot action is attributed to departments
-- and surfaced as an activity feed inside each department's module in the TMS.

-- which departments an action belongs to (drives where it shows in the UI)
alter table assistant_actions
  add column if not exists departments text[] not null default '{}';

alter table pti_inspections
  add column if not exists departments text[] not null default '{safety,maintenance}';

alter table incident_reports
  add column if not exists departments text[] not null default '{safety,dispatch,maintenance,fleet,tracking}';

-- reminders already carry mention_departments (jsonb); normalize in the view below.

-- summary text the feed can show without joining everything client-side
alter table assistant_actions add column if not exists summary text;
alter table reminders add column if not exists summary text;

-- ============================================================ unified department activity view
-- One row per (event, department). Each module queries:
--   select * from v_department_activity
--   where company_id = :cid and department = 'safety'
--   order by happened_at desc limit 50;
create or replace view v_department_activity as
-- bot actions (BOL notices, tracking updates, custom emails...)
select
  a.company_id,
  d.department,
  'assistant_action'::text as source,
  a.id as source_id,
  a.kind,
  a.status,
  coalesce(a.summary,
    case a.kind
      when 'bol_loaded_notice' then 'BOL received — loaded notice'
      when 'tracking_update'   then 'Tracking update sent to broker'
      when 'pti_alert'         then 'PTI alert'
      when 'incident_alert'    then 'Incident alert'
      when 'delivered_notice'  then 'Delivered notice sent'
      when 'reminder'          then 'Reminder'
      else a.kind end) as title,
  a.load_id, a.truck_id, a.driver_id,
  a.created_at as happened_at
from assistant_actions a
cross join lateral unnest(
  case when array_length(a.departments,1) is null then array['dispatch'] else a.departments end
) as d(department)

union all
-- reminders that were sent (incl. compliance expiry -> safety, PM -> maintenance)
select
  r.company_id,
  d.department,
  'reminder', r.id, r.kind, r.status,
  coalesce(r.summary, r.title),
  r.load_id, r.truck_id, r.driver_id,
  coalesce(r.sent_at, r.due_at)
from reminders r
cross join lateral (
  select jsonb_array_elements_text(
    case when jsonb_array_length(r.mention_departments) > 0
         then r.mention_departments else '["dispatch"]'::jsonb end)
) as d(department)
where r.status in ('sent','done')

union all
-- PTI screenings
select
  p.company_id, d.department, 'pti_inspection', p.id,
  'pti'::text, p.result,
  case p.result
    when 'pass' then 'PTI received — no visible issues'
    when 'flagged' then 'PTI flagged — possible DOT issues'
    else 'PTI analysis' end,
  null::uuid, p.truck_id, p.driver_id,
  p.created_at
from pti_inspections p
cross join lateral unnest(p.departments) as d(department)

union all
-- incidents (accidents)
select
  i.company_id, d.department, 'incident', i.id,
  'incident'::text, i.status,
  'POSSIBLE ACCIDENT reported' ||
    case when i.severity <> 'unknown' then ' (' || i.severity || ')' else '' end,
  i.load_id, i.truck_id, i.driver_id,
  i.created_at
from incident_reports i
cross join lateral unnest(i.departments) as d(department);

-- Views run with the caller's rights; underlying tables' RLS applies (members can
-- select all four source tables, so the feed is visible to everyone, matching the
-- "everyone views everything" rule).

-- helpful indexes for the feed ordering
create index if not exists idx_actions_company_time on assistant_actions(company_id, created_at desc);
create index if not exists idx_reminders_company_time on reminders(company_id, due_at desc);
create index if not exists idx_pti_company_time on pti_inspections(company_id, created_at desc);
create index if not exists idx_incidents_company_time on incident_reports(company_id, created_at desc);
