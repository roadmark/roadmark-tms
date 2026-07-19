-- Optional: sample repair cases so the Cases board has content.
-- Run once in the Supabase SQL Editor after migration 015.

do $$
declare
  cid uuid := '11111111-1111-1111-1111-111111111111';
  t4114 uuid; t7273 uuid; t3547 uuid; r08812 uuid;
  d1 uuid; d2 uuid; d3 uuid; v1 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
begin
  select id into t4114 from trucks where company_id=cid and unit_number='4114';
  select id into t7273 from trucks where company_id=cid and unit_number='7273';
  select id into t3547 from trucks where company_id=cid and unit_number='3547';
  select id into r08812 from trailers where company_id=cid and unit_number='R08812';
  select id into d1 from drivers where company_id=cid and full_name='Marcus Bell';
  select id into d2 from drivers where company_id=cid and full_name='Sofia Petrov';
  select id into d3 from drivers where company_id=cid and full_name='Devon Carter';
  select id into v1 from vendors where company_id=cid limit 1;

  insert into repair_cases (company_id, title, description, unit_type, truck_id, trailer_id,
    driver_id, priority, status, category, down_unit, location_text, estimate_amount, vendor_id, created_at)
  values
    (cid, 'Reefer not holding temp', 'Set to -10F, box is reading +18F after two hours. Load is frozen poultry.',
     'trailer', null, r08812, d2, 'critical', 'repair', 'refrigeration', true,
     'TA Travel Center, Gary IN', 1800.00, v1, now() - interval '19 hours'),
    (cid, 'Check engine light + derate', 'Derated to 5 mph after warning. Code came up this morning.',
     'truck', t3547, null, d3, 'critical', 'awaiting_approval', 'aftertreatment', true,
     'Milwaukee WI', 4200.00, null, now() - interval '2 days'),
    (cid, 'Brakes grinding on front axle', 'Noise on braking since yesterday, gets worse when loaded.',
     'truck', t7273, null, d2, 'high', 'diagnostics', 'brakes', false,
     'Chicago yard', null, null, now() - interval '1 day'),
    (cid, 'Air leak in suspension', 'Bags drop overnight, takes a while to build back up.',
     'truck', t4114, null, d1, 'medium', 'created', 'suspension', false,
     null, null, null, now() - interval '6 hours'),
    (cid, 'Marker light lens broken (driver side)', 'Found on PTI — flagged by the inspection bot.',
     'truck', t3547, null, d3, 'low', 'created', 'electrical', false,
     null, 45.00, null, now() - interval '26 hours');

  -- a couple of comments so the cards show activity
  select id into c1 from repair_cases where company_id=cid and title='Reefer not holding temp';
  select id into c2 from repair_cases where company_id=cid and title='Check engine light + derate';
  select id into c3 from repair_cases where company_id=cid and title='Brakes grinding on front axle';

  insert into case_comments (case_id, company_id, body, kind, author_label, created_at) values
    (c1, cid, 'Driver reported in truck group. Load is temperature-critical — pushing this to the top.', 'comment', 'Dispatch', now() - interval '18 hours'),
    (c1, cid, 'Shop found the condenser fan seized. Part on order, back on the road tomorrow AM.', 'comment', 'Maintenance', now() - interval '4 hours'),
    (c2, cid, 'Estimate came in at $4,200. Waiting on owner approval before authorising the work.', 'comment', 'Maintenance', now() - interval '20 hours'),
    (c3, cid, 'Booked into the Joliet shop for Monday 07:00.', 'comment', 'Maintenance', now() - interval '3 hours');
end $$;

select case_number, title, priority, status from repair_cases
where company_id = '11111111-1111-1111-1111-111111111111' order by case_number;
