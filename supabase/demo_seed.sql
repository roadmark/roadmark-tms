-- demo_seed.sql — run ONCE in the Supabase SQL Editor AFTER all migrations.
-- Creates a demo company (fixed id so the membership insert is copy-paste),
-- realistic sample data, and assistant activity so every department feed is alive.

do $$
declare
  cid uuid := '11111111-1111-1111-1111-111111111111';
  d1 uuid; d2 uuid; d3 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  tr1 uuid; tr2 uuid;
  c1 uuid; c2 uuid;
  v1 uuid;
  l1 uuid; l2 uuid; l3 uuid;
  mi uuid;
begin
  -- company
  insert into companies (id, name, mc_number, dot_number, city, state, phone)
  values (cid, 'Roadmark Demo Carrier LLC', 'MC-000000', 'DOT-0000000', 'Chicago', 'IL', '(312) 555-0100')
  on conflict (id) do nothing;

  -- customers
  insert into customers (company_id, name, mc_number, billing_email, phone, payment_terms_days)
  values (cid, 'Blue Ridge Logistics', 'MC-771234', 'ap@blueridgelog.example', '(704) 555-0142', 30)
  returning id into c1;
  insert into customers (company_id, name, mc_number, billing_email, phone, payment_terms_days)
  values (cid, 'Lakeshore Freight Brokers', 'MC-559911', 'billing@lakeshorefb.example', '(414) 555-0177', 21)
  returning id into c2;

  -- drivers
  insert into drivers (company_id, full_name, phone, email, status, driver_type, cdl_number, cdl_state, pay_rate_type, pay_rate, hire_date)
  values (cid, 'Marcus Bell', '(773) 555-0121', 'marcus.bell@example.com', 'active', 'lease_to_buy', 'B550-1123-4451', 'IL', 'percentage', 0.88, current_date - 320)
  returning id into d1;
  insert into drivers (company_id, full_name, phone, email, status, driver_type, cdl_number, cdl_state, pay_rate_type, pay_rate, hire_date)
  values (cid, 'Sofia Petrov', '(224) 555-0187', 'sofia.petrov@example.com', 'active', 'company', 'P441-9020-1177', 'IN', 'per_total_mile', 0.65, current_date - 145)
  returning id into d2;
  insert into drivers (company_id, full_name, phone, email, status, driver_type, cdl_number, cdl_state, pay_rate_type, pay_rate, hire_date)
  values (cid, 'Devon Carter', '(872) 555-0165', 'devon.carter@example.com', 'ready', 'owner', 'C118-3345-9902', 'WI', 'percentage', 0.90, current_date - 20)
  returning id into d3;

  -- trucks + trailers
  insert into trucks (company_id, unit_number, vin, make, model, year, ownership, status, plate, plate_state)
  values (cid, '4114', '1FUJHHDR5NLMA4114', 'Freightliner', 'Cascadia', 2023, 'lease_to_buy', 'active', 'P881123', 'IL')
  returning id into t1;
  insert into trucks (company_id, unit_number, vin, make, model, year, ownership, status, plate, plate_state)
  values (cid, '7273', '3AKJHHDR8PSNB7273', 'Freightliner', 'Cascadia', 2024, 'company', 'active', 'P990241', 'IL')
  returning id into t2;
  insert into trucks (company_id, unit_number, vin, make, model, year, ownership, status, plate, plate_state)
  values (cid, '3547', '1XKYDP9X4MJ543547', 'Kenworth', 'T680', 2021, 'owner', 'for_check', 'TR44120', 'WI')
  returning id into t3;
  insert into trailers (company_id, unit_number, vin, make, year, trailer_type, ownership, status, plate, plate_state)
  values (cid, 'D050065', '1GR1P0624SK650065', 'Great Dane', 2025, 'dry_van', 'lease_to_buy', 'active', '1001695ST', 'IL')
  returning id into tr1;
  insert into trailers (company_id, unit_number, vin, make, year, trailer_type, ownership, status, plate, plate_state)
  values (cid, 'R08812', '1UYVS2538RM088812', 'Utility', 2024, 'reefer', 'company', 'active', '1044821ST', 'IL')
  returning id into tr2;

  -- current assignments
  insert into assignments (company_id, driver_id, truck_id, trailer_id) values (cid, d1, t1, tr1);
  insert into assignments (company_id, driver_id, truck_id, trailer_id) values (cid, d2, t2, tr2);

  -- vendor + a maintenance invoice with a mixed split
  insert into vendors (company_id, name, phone, city, state)
  values (cid, 'I-80 Truck & Trailer Repair', '(815) 555-0133', 'Joliet', 'IL') returning id into v1;
  insert into maintenance_invoices (company_id, invoice_number, unit_type, truck_id, driver_id, vendor_id,
    in_date, out_date, payment_type, status, subtotal, tax, total, on_company_total, on_driver_total, odometer)
  values (cid, 'INV-88412', 'truck', t1, d1, v1, current_date - 6, current_date - 5,
    'efs', 'paid', 1245.00, 74.70, 1319.70, 869.70, 450.00, 412350) returning id into mi;
  insert into maintenance_tasks (invoice_id, company_id, description, quantity, unit_price, amount, charge_to) values
    (mi, cid, 'Steer tire replacement (RF)', 1, 450.00, 450.00, 'driver'),
    (mi, cid, 'PM service — oil, filters', 1, 585.00, 585.00, 'company'),
    (mi, cid, 'Marker light lens', 2, 105.00, 210.00, 'company');

  -- loads (statuses across the lifecycle; load_number auto-assigns 1..3)
  insert into loads (company_id, status, customer_id, customer_load_id, driver_id, truck_id, trailer_id,
    pickup_location, pickup_time, delivery_location, delivery_time,
    loaded_miles, empty_miles, freight_amount, driver_rate, weight_lbs,
    driver_pay_type, driver_pay_rate)
  values (cid, 'in_progress', c1, 'BR-20841', d1, t1, tr1,
    'Houston, TX', now() - interval '18 hours', 'Rochester, NY (+1)', now() + interval '30 hours',
    1555, 264, 5400.00, 4752.00, 42585, 'percentage', 0.88) returning id into l1;
  insert into loads (company_id, status, customer_id, customer_load_id, driver_id, truck_id, trailer_id,
    pickup_location, pickup_time, delivery_location, delivery_time,
    loaded_miles, empty_miles, freight_amount, driver_rate, weight_lbs,
    driver_pay_type, driver_pay_rate)
  values (cid, 'scheduled', c2, 'LSF-11209', d2, t2, tr2,
    'Chicago, IL', now() + interval '14 hours', 'Atlanta, GA', now() + interval '40 hours',
    716, 42, 2350.00, 492.70, 38200, 'per_total_mile', 0.65) returning id into l2;
  insert into loads (company_id, status, customer_id, customer_load_id, driver_id, truck_id, trailer_id,
    pickup_location, pickup_time, delivery_location, delivery_time,
    loaded_miles, empty_miles, freight_amount, driver_rate, weight_lbs,
    driver_pay_type, driver_pay_rate)
  values (cid, 'delivered', c1, 'BR-20719', d1, t1, tr1,
    'Memphis, TN', now() - interval '4 days', 'Columbus, OH', now() - interval '3 days',
    612, 105, 2100.00, 1848.00, 27400, 'percentage', 0.88) returning id into l3;

  -- money: fuel, tolls, deductions, credits, recurring schedule
  insert into fuel_transactions (company_id, driver_id, truck_id, transaction_id, issued_date, city, state, product, quantity, amount, fee, total, charge_to)
  values
    (cid, d1, t1, 'EFS-99120041', current_date - 2, 'Effingham', 'IL', 'ULSD', 142.6, 498.10, 2.50, 500.60, 'driver'),
    (cid, d1, t1, 'EFS-99120388', current_date - 1, 'Knoxville', 'TN', 'ULSD', 118.2, 419.55, 2.50, 422.05, 'driver'),
    (cid, d2, t2, 'EFS-99121002', current_date - 1, 'Gary', 'IN', 'DEFD', 9.4, 31.02, 0, 31.02, 'driver');
  insert into toll_transactions (company_id, driver_id, truck_id, transaction_id, tag_number, plaza_name, issued_date, amount, charge_to)
  values
    (cid, d1, t1, '1442347742', 'B7010365681', 'Will Rogers Turnpike Eastbound', current_date - 2, 11.31, 'driver'),
    (cid, d2, t2, '1442399811', 'B7010365702', 'Chicago Skyway', current_date - 1, 8.90, 'driver');
  insert into deductions (company_id, driver_id, truck_id, issued_date, charge_to, category, description, amount, total, source_maintenance_invoice_id)
  values (cid, d1, t1, current_date - 5, 'driver', 'maintenance', 'EFS-Repair-I-80 Truck & Trailer-INV-88412', 450.00, 450.00, mi);
  insert into credits (company_id, driver_id, issued_date, category, description, amount, load_id)
  values (cid, d1, current_date - 3, 'detention', 'Detention 4h — BR-20719 delivery', 140.00, l3);
  insert into recurring_deductions (company_id, driver_id, name, amount, frequency, anchor_dow, start_date)
  values (cid, d1, 'Truck rent', 750.00, 'weekly', 1, current_date - 60);
  insert into recurring_deduction_runs (recurring_deduction_id, company_id, driver_id, run_date, period_start, period_end, amount)
  select id, cid, d1, current_date - 1, current_date - 8, current_date - 2, 750.00
  from recurring_deductions where company_id = cid limit 1;

  -- ELD positions (so Track & Trace has rows)
  insert into unit_locations (company_id, truck_id, lat, lng, speed_mph, heading, engine_state, address_text, located_at, source, provider)
  values
    (cid, t1, 41.4993, -81.6944, 62.0, 78, 'On', 'I-90 E near Cleveland, OH', now() - interval '3 minutes', 'api', 'samsara'),
    (cid, t2, 41.8781, -87.6298, 0.0, 0, 'Off', 'Yard — Chicago, IL', now() - interval '22 minutes', 'api', 'samsara'),
    (cid, t3, 43.0389, -87.9065, 0.0, 0, 'Off', 'Milwaukee, WI', now() - interval '26 hours', 'api', 'motive');

  -- ================= assistant activity (what the bots will do, shown live) =================
  insert into assistant_actions (company_id, kind, status, load_id, truck_id, driver_id, departments, summary, sent_at, created_at) values
    (cid, 'bol_loaded_notice', 'sent', l1, t1, d1, array['dispatch'],
     'BOL received in group 4114 — dispatcher approved — "We are loaded" + BOL sent reply-all to Blue Ridge chain (BR-20841)',
     now() - interval '17 hours', now() - interval '17 hours'),
    (cid, 'tracking_update', 'sent', l1, t1, d1, array['dispatch','tracking'],
     'Hourly update #17 to Blue Ridge chain: near Cleveland OH, 288 mi out, ETA Jul 20 09:40',
     now() - interval '38 minutes', now() - interval '38 minutes'),
    (cid, 'tracking_update', 'sent', l1, t1, d1, array['dispatch','tracking'],
     'Hourly update #16 to Blue Ridge chain: near Toledo OH, ETA on time',
     now() - interval '98 minutes', now() - interval '98 minutes'),
    (cid, 'reminder', 'sent', l2, t2, d2, array['dispatch'],
     'Appointment reminder in group 7273: pickup Chicago IL in 2 h — tagged Sofia + dispatcher',
     now() - interval '2 hours', now() - interval '2 hours'),
    (cid, 'pti_alert', 'sent', null, t3, d3, array['safety','maintenance'],
     'PTI 3547 flagged: RF steer tire tread appears worn (photo 2), left marker lens broken (photo 5) — tagged driver, dispatcher, maintenance, safety + team leaders',
     now() - interval '26 hours', now() - interval '26 hours'),
    (cid, 'incident_alert', 'sent', null, t2, d2, array['safety','dispatch','maintenance','fleet','tracking'],
     'TEST DRILL: accident keyword detected in group 7273 — all departments tagged in 4 s, acknowledged by Safety in 2 min',
     now() - interval '3 days', now() - interval '3 days');

  insert into reminders (company_id, kind, title, body, due_at, mention_departments, mention_driver, driver_id, status, sent_at, summary) values
    (cid, 'compliance', 'Medical card expiring', 'MED for Marcus Bell expires in 14 days',
     now() - interval '5 hours', '["safety"]'::jsonb, true, d1, 'sent', now() - interval '5 hours',
     'MED expiring Aug 2 — tagged Marcus + safety in group 4114'),
    (cid, 'pm_service', 'PM due — truck 4114', 'PM interval reached at 412,000 mi',
     now() - interval '1 day', '["maintenance"]'::jsonb, false, d1, 'sent', now() - interval '1 day',
     'PM due on 4114 (412,350 mi) — tagged maintenance');

  insert into pti_inspections (company_id, truck_id, driver_id, result, violations, analysis) values
    (cid, t1, d1, 'pass', '[]'::jsonb, '{"photos":6,"notes":"no visible issues"}'::jsonb),
    (cid, t3, d3, 'flagged',
     '[{"code":"tire_tread","label":"Possible worn steer tire (RF)","severity":"violation","confidence":0.82,"image_index":2},
       {"code":"light_lens","label":"Broken left marker light lens","severity":"violation","confidence":0.91,"image_index":5}]'::jsonb,
     '{"photos":7}'::jsonb);

  insert into incident_reports (company_id, source, reported_text, driver_id, truck_id, severity, status, notes) values
    (cid, 'telegram', 'TEST DRILL — "we got hit at the dock"', d2, t2, 'minor', 'closed',
     'Quarterly response drill. All departments tagged in 4 seconds; closed as drill.');

end $$;

-- sanity output
select 'companies' t, count(*) from companies where id = '11111111-1111-1111-1111-111111111111'
union all select 'drivers', count(*) from drivers where company_id = '11111111-1111-1111-1111-111111111111'
union all select 'loads', count(*) from loads where company_id = '11111111-1111-1111-1111-111111111111'
union all select 'activity rows', count(*) from v_department_activity where company_id = '11111111-1111-1111-1111-111111111111';
