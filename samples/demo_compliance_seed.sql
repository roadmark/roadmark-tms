-- Optional: adds sample compliance items + an insurance policy so the new
-- Compliance / Insurance screens and the Overview alert panel have data.
-- Run once in the Supabase SQL Editor. Safe to skip if you prefer entering your own.

do $$
declare
  cid uuid := '11111111-1111-1111-1111-111111111111';
  d_marcus uuid; d_sofia uuid; d_devon uuid;
  t4114 uuid; t7273 uuid;
  ct_med uuid; ct_cdl uuid; ct_mvr uuid; ct_dt uuid; ct_reg uuid; ct_insp uuid;
  pol uuid;
begin
  select id into d_marcus from drivers where company_id=cid and full_name='Marcus Bell';
  select id into d_sofia  from drivers where company_id=cid and full_name='Sofia Petrov';
  select id into d_devon  from drivers where company_id=cid and full_name='Devon Carter';
  select id into t4114 from trucks where company_id=cid and unit_number='4114';
  select id into t7273 from trucks where company_id=cid and unit_number='7273';
  select id into ct_med  from compliance_types where code='MED'  and applies_to='driver' limit 1;
  select id into ct_cdl  from compliance_types where code='CDL'  and applies_to='driver' limit 1;
  select id into ct_mvr  from compliance_types where code='MVR'  and applies_to='driver' limit 1;
  select id into ct_dt   from compliance_types where code='DT'   and applies_to='driver' limit 1;
  select id into ct_reg  from compliance_types where code='REG'  and applies_to='truck'  limit 1;
  select id into ct_insp from compliance_types where code='INSP' and applies_to='truck'  limit 1;

  -- drivers: one expiring soon, one expired, the rest valid
  insert into compliance_items (company_id, compliance_type_id, entity_type, entity_id, issue_date, expiry_date, status) values
    (cid, ct_med, 'driver', d_marcus, current_date - 715, current_date + 14, 'expiring'),
    (cid, ct_cdl, 'driver', d_marcus, current_date - 900, current_date + 400, 'valid'),
    (cid, ct_mvr, 'driver', d_marcus, current_date - 360, current_date + 5,  'expiring'),
    (cid, ct_med, 'driver', d_sofia,  current_date - 200, current_date + 530, 'valid'),
    (cid, ct_dt,  'driver', d_sofia,  current_date - 400, current_date - 35,  'expired'),
    (cid, ct_cdl, 'driver', d_devon,  current_date - 100, current_date + 900, 'valid')
  on conflict do nothing;

  -- trucks
  insert into compliance_items (company_id, compliance_type_id, entity_type, entity_id, issue_date, expiry_date, status) values
    (cid, ct_reg,  'truck', t4114, current_date - 300, current_date + 60, 'valid'),
    (cid, ct_insp, 'truck', t4114, current_date - 350, current_date + 15, 'expiring'),
    (cid, ct_reg,  'truck', t7273, current_date - 200, current_date + 160, 'valid')
  on conflict do nothing;

  -- an insurance policy with units enrolled
  insert into insurance_policies (company_id, policy_type, policy_number, insurer, start_date, end_date,
    premium_total, installment_amount, coverage_basis, status, agent_name, agent_phone)
  values (cid, 'auto_liability', 'AL-2026-88120', 'Great Lakes Casualty',
    current_date - 120, current_date + 245, 92400.00, 7700.00, 'per_unit', 'active',
    'Dana Whitfield', '(312) 555-0188')
  returning id into pol;

  insert into insurance_enrollments (policy_id, company_id, entity_type, truck_id, monthly_cost, charged_to_driver) values
    (pol, cid, 'truck', t4114, 685.00, true),
    (pol, cid, 'truck', t7273, 685.00, false);

  insert into insurance_policies (company_id, policy_type, policy_number, insurer, start_date, end_date,
    premium_total, coverage_basis, status)
  values (cid, 'cargo', 'CA-2026-44019', 'Great Lakes Casualty',
    current_date - 120, current_date + 20, 18600.00, 'blanket', 'active');
end $$;

select 'compliance items' as what, count(*) from compliance_items
union all select 'insurance policies', count(*) from insurance_policies;
