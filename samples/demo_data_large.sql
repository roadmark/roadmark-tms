-- demo_data_large.sql — full-size demo dataset for Roadmark TMS
--
-- Creates: 26 drivers · 30 trucks · 35 trailers · 26 assignments · 12 customers
--          70 loads (60 delivered in the last month + 10 running now)
--             · 45 completed and paid   · 5 invoiced, still unpaid
--             · 10 delivered, not invoiced yet
--          60 repair cases across the last 35 days
--          fuel, tolls, deductions and recurring deductions to settle against
--
-- WARNING: this REPLACES the operational demo data for the demo company
-- (11111111-1111-1111-1111-111111111111). Your login, company and any other
-- company are untouched. Run once in the Supabase SQL Editor.

do $$
declare
  cid uuid := '11111111-1111-1111-1111-111111111111';
  dispatchers uuid[];
  driver_ids uuid[] := '{}';
  truck_ids uuid[] := '{}';
  trailer_ids uuid[] := '{}';
  customer_ids uuid[] := '{}';
  vendor_ids uuid[] := '{}';

  first_names text[] := array['Marcus','Sofia','Devon','Andre','Milan','Tyrell','Goran','Rashad','Petar','Jamal',
                              'Nikola','Damion','Stefan','Curtis','Vlado','Terrance','Bojan','Lamar','Zoran','Elias',
                              'Dragan','Keandre','Ivan','Malik','Radomir','Jerome'];
  last_names  text[] := array['Bell','Petrov','Carter','Whitfield','Jovic','Banks','Markovic','Coleman','Ilic','Freeman',
                              'Savic','Reed','Novak','Hollis','Pavlovic','Dailey','Kostic','Ellis','Radic','Pope',
                              'Simic','Davis','Lukic','Grant','Tomic','Watts'];
  cities text[] := array['Chicago, IL','Atlanta, GA','Dallas, TX','Memphis, TN','Columbus, OH','Charlotte, NC',
                         'Indianapolis, IN','Kansas City, MO','Nashville, TN','Houston, TX','Phoenix, AZ','Denver, CO',
                         'Laredo, TX','Savannah, GA','Harrisburg, PA','Allentown, PA','Joliet, IL','Louisville, KY',
                         'Jacksonville, FL','Salt Lake City, UT','Reno, NV','Fort Worth, TX','Greensboro, NC','Toledo, OH',
                         'Des Moines, IA','Little Rock, AR','Birmingham, AL','Rochester, NY','Springfield, MO','Laredo, TX'];
  makes text[] := array['Freightliner','Volvo','Kenworth','Peterbilt','International','Mack','Western Star'];
  models text[] := array['Cascadia','VNL 860','T680','579','LT','Anthem','5700XE'];
  brokers text[] := array['Blue Ridge Logistics','Lakeshore Freight Brokers','Sunbelt Transport Group','Keystone Freight Partners',
                          'Great Plains Logistics','Coastal Carriers Exchange','Redstone Freight Systems','Summit Load Solutions',
                          'Ironwood Logistics','Cardinal Freight Brokers','Northline Transport','Vanguard Freight Group'];
  shops text[] := array['I-80 Truck & Trailer Repair','Midwest Diesel Service','Southern Fleet Care','Interstate Tire Center',
                        'Precision Truck Works','Great Lakes Truck Repair'];
  case_titles text[] := array[
    'Reefer not holding temp','Check engine light + derate','Brakes grinding on front axle','Air leak in suspension',
    'DPF regen failing','Coolant leak at water pump','Trailer ABS fault','Steer tire worn to cords',
    'Alternator not charging','APU will not start','Landing gear bent','Marker lights out on driver side',
    'Fifth wheel slack','Def system fault code','Turbo boost pressure low','Cab heater blowing cold',
    'Trailer door seal torn','Wheel seal leaking oil','Clutch slipping under load','Windshield cracked in wiper path'];
  case_cats text[] := array['refrigeration','engine','brakes','suspension','aftertreatment','cooling','trailer','tires',
                            'electrical','other','trailer','electrical','body','aftertreatment','engine','other',
                            'trailer','brakes','transmission','body'];

  i int; j int; k int;
  nid uuid; tid uuid; rid uuid; cust uuid; drv uuid; trk uuid; trl uuid;
  lid uuid; inv uuid; cs uuid;
  pu text; del text; pu_i int; del_i int;
  lm int; em int; rate numeric; drate numeric; pct numeric;
  pick timestamptz; drop_ timestamptz;
  st text; n_done int;
begin
  perform setseed(0.4242);

  -- ---------- wipe the demo company's operational data ----------
  delete from case_comments where company_id = cid;
  delete from repair_cases where company_id = cid;
  delete from settlement_lines where company_id = cid;
  delete from settlements where company_id = cid;
  delete from invoice_payments where company_id = cid;
  delete from invoices where company_id = cid;
  delete from check_calls where company_id = cid;
  delete from load_stops where company_id = cid;
  delete from load_status_history where company_id = cid;
  delete from maintenance_tasks where company_id = cid;
  delete from maintenance_invoices where company_id = cid;
  delete from fuel_transactions where company_id = cid;
  delete from toll_transactions where company_id = cid;
  delete from recurring_deduction_runs where company_id = cid;
  delete from recurring_deductions where company_id = cid;
  delete from deductions where company_id = cid;
  delete from credits where company_id = cid;
  delete from balance_dues where company_id = cid;
  delete from documents where company_id = cid;
  delete from unit_locations where company_id = cid;
  delete from odometer_readings where company_id = cid;
  delete from compliance_items where company_id = cid;
  delete from insurance_enrollments where company_id = cid;
  delete from insurance_policies where company_id = cid;
  delete from assignments where company_id = cid;
  delete from loads where company_id = cid;
  delete from drivers where company_id = cid;
  delete from trucks where company_id = cid;
  delete from trailers where company_id = cid;
  delete from customers where company_id = cid;
  delete from vendors where company_id = cid;
  update companies set next_load_number = 1, next_case_number = 1 where id = cid;

  select array_agg(user_id) into dispatchers from company_members where company_id = cid;

  -- ---------- customers ----------
  for i in 1..12 loop
    insert into customers (company_id, name, mc_number, billing_email, phone, payment_terms_days, factoring)
    values (cid, brokers[i], 'MC-' || (500000 + i * 1373),
            lower(replace(split_part(brokers[i],' ',1),'','')) || '.ap@example.com',
            '(' || (300 + i) || ') 555-0' || (100 + i), (array[21,30,30,45])[1 + floor(random()*4)::int], true)
    returning id into cust;
    customer_ids := customer_ids || cust;
  end loop;

  -- ---------- vendors ----------
  foreach st in array shops loop
    insert into vendors (company_id, name, city, state, phone)
    values (cid, st, cities[1 + floor(random()*20)::int], 'IL', '(815) 555-0' || (100 + floor(random()*99)::int))
    returning id into nid;
    vendor_ids := vendor_ids || nid;
  end loop;

  -- ---------- trucks ----------
  for i in 1..30 loop
    insert into trucks (company_id, unit_number, vin, make, model, year, truck_type, ownership, status,
                        plate, plate_state, registrant, toll_device_code)
    values (cid, (3500 + i * 37)::text,
            '1FUJ' || upper(substr(md5(random()::text), 1, 13)),
            makes[1 + (i % 7)], models[1 + (i % 7)], 2019 + (i % 7), 'semi_truck',
            (array['company','owner','rent','lease_to_buy'])[1 + (i % 4)],
            case when i % 17 = 0 then 'for_shop' when i % 23 = 0 then 'shop'
                 when i % 29 = 0 then 'for_check' else 'active' end,
            'P' || (880000 + i * 91), (array['IL','WI','IN','GA','TX'])[1 + (i % 5)],
            (array['Planet Logistics Inc','Straight Freight LLC','Maxim Expedited Llc','Happy Transport'])[1 + (i % 4)],
            'B70103' || (40000 + i * 13))
    returning id into tid;
    truck_ids := truck_ids || tid;
  end loop;

  -- ---------- trailers ----------
  for i in 1..35 loop
    insert into trailers (company_id, unit_number, vin, make, year, trailer_type, ownership, status, plate, plate_state)
    values (cid, (case when i % 4 = 0 then 'R' else 'D' end) || (50000 + i * 271)::text,
            '1GR1' || upper(substr(md5(random()::text), 1, 13)),
            (array['Great Dane','Utility','Wabash','Hyundai'])[1 + (i % 4)],
            2020 + (i % 6),
            case when i % 4 = 0 then 'reefer' when i % 11 = 0 then 'flatbed' else 'dry_van' end,
            (array['company','owner','rent','lease_to_buy'])[1 + (i % 4)],
            case when i % 19 = 0 then 'for_shop' else 'active' end,
            (1000000 + i * 137)::text || 'ST', 'IL')
    returning id into rid;
    trailer_ids := trailer_ids || rid;
  end loop;

  -- ---------- drivers ----------
  for i in 1..26 loop
    pct := (array[0.88, 0.88, 0.90, 0.85, 0.92])[1 + (i % 5)];
    insert into drivers (company_id, full_name, email, phone, ssn, status, driver_type,
                         cdl_number, cdl_state, pay_rate_type, pay_rate, hire_date,
                         dispatcher_id, deduct_fuel, deduct_tolls)
    values (cid, first_names[i] || ' ' || last_names[i],
            lower(first_names[i] || '.' || last_names[i]) || '@example.com',
            '(' || (200 + i) || ') 555-' || (1000 + i * 7),
            (100000000 + i * 7654321)::text,
            case when i > 24 then 'ready' else 'active' end,
            (array['company','owner','rent','lease_to_buy','contractor'])[1 + (i % 5)],
            upper(substr(md5(random()::text),1,3)) || (100000 + i * 811), 'IL',
            case when i % 4 = 0 then 'per_total_mile' else 'percentage' end,
            case when i % 4 = 0 then 0.62 + (i % 5) * 0.02 else pct end,
            current_date - (120 + i * 9),
            dispatchers[1 + (i % greatest(array_length(dispatchers,1),1))],
            true, true)
    returning id into drv;
    driver_ids := driver_ids || drv;

    -- assignment: driver i gets truck i and trailer i
    insert into assignments (company_id, driver_id, truck_id, trailer_id, started_at)
    values (cid, drv, truck_ids[i], trailer_ids[i], now() - (60 + i) * interval '1 day');

    -- weekly truck rent for the leased/rented drivers
    if (i % 4) in (2, 3) then
      insert into recurring_deductions (company_id, driver_id, name, amount, frequency, anchor_dow, start_date)
      values (cid, drv, 'Truck rent', 750.00, 'weekly', 1, current_date - 90);
      insert into recurring_deductions (company_id, driver_id, name, amount, frequency, anchor_dow, start_date)
      values (cid, drv, 'ELD Device', 50.00, 'weekly', 1, current_date - 90);
    end if;
  end loop;

  -- ---------- loads ----------
  -- 60 delivered in the last month, 10 running now
  for i in 1..70 loop
    drv  := driver_ids[1 + (i % 26)];
    trk  := truck_ids[1 + (i % 26)];
    trl  := trailer_ids[1 + (i % 26)];
    cust := customer_ids[1 + (i % 12)];
    pu_i := 1 + floor(random() * 30)::int;
    del_i := 1 + floor(random() * 30)::int;
    if del_i = pu_i then del_i := 1 + ((pu_i + 7) % 30); end if;
    pu := cities[pu_i]; del := cities[del_i];
    lm := 320 + floor(random() * 1500)::int;
    em := 20 + floor(random() * 180)::int;
    rate := round((lm * (2.05 + random() * 1.55))::numeric, -1);
    pct := coalesce((select d.pay_rate from drivers d where d.id = drv), 0.88);
    drate := case when pct < 2 then round(rate * pct, 2) else round((lm + em) * pct, 2) end;

    if i <= 10 then
      -- currently running: picked up in the last 2 days, delivering in the next 1–3
      pick := now() - (random() * 2) * interval '1 day';
      drop_ := now() + (0.5 + random() * 2.5) * interval '1 day';
      st := 'in_progress';
    else
      -- delivered somewhere in the last 30 days
      pick := now() - ((2 + random() * 28) || ' days')::interval;
      drop_ := pick + ((1 + random() * 2.5) || ' days')::interval;
      if i <= 55 then st := 'completed';           -- 45 paid
      elsif i <= 60 then st := 'payment_pending';  -- 5 invoiced, unpaid
      else st := 'delivered';                      -- 10 not invoiced yet
      end if;
    end if;

    insert into loads (company_id, status, customer_id, customer_load_id, dispatcher_id,
                       driver_id, truck_id, trailer_id, pickup_location, pickup_time,
                       delivery_location, delivery_time, loaded_miles, empty_miles,
                       freight_amount, driver_rate, weight_lbs, commodity,
                       driver_pay_type, driver_pay_rate)
    values (cid, st, cust,
            upper(substr(md5(random()::text),1,2)) || '-' || (20000 + i * 137),
            (select d.dispatcher_id from drivers d where d.id = drv),
            drv, trk, trl, pu, pick, del, drop_, lm, em, rate, drate,
            22000 + floor(random() * 22000)::int,
            (array['General freight','Frozen poultry','Paper goods','Auto parts','Beverages','Building materials'])[1 + (i % 6)],
            case when pct < 2 then 'percentage' else 'per_total_mile' end, pct)
    returning id into lid;

    -- stops
    insert into load_stops (load_id, company_id, seq, stop_type, city, state, scheduled_at, appointment_type)
    values (lid, cid, 1, 'pickup', split_part(pu, ',', 1), trim(split_part(pu, ',', 2)), pick,
            case when i % 5 = 0 then 'fcfs' else 'appt' end),
           (lid, cid, 2, 'delivery', split_part(del, ',', 1), trim(split_part(del, ',', 2)), drop_, 'appt');

    -- invoices for everything except the 10 not-yet-invoiced
    if st in ('completed', 'payment_pending') then
      insert into invoices (company_id, load_id, invoice_number, invoice_date, amount, balance, status, sent_at)
      values (cid, lid, 'INV-' || (select load_number from loads where id = lid),
              (drop_ + interval '1 day')::date, rate,
              case when st = 'completed' then 0 else rate end,
              case when st = 'completed' then 'paid' else 'sent' end,
              drop_ + interval '1 day')
      returning id into inv;
      if st = 'completed' then
        insert into invoice_payments (invoice_id, company_id, amount, method, paid_at)
        values (inv, cid, rate, 'ach', (drop_ + interval '18 days')::date);
        update invoices set paid_at = (drop_ + interval '18 days')::date where id = inv;
      end if;
    end if;

    -- fuel + tolls on recent loads so settlements have something to chew on
    if i <= 30 then
      insert into fuel_transactions (company_id, driver_id, truck_id, transaction_id, issued_date,
                                     city, state, product, quantity, amount, fee, total, charge_to, status)
      values (cid, drv, trk, 'EFS-' || (99000000 + i * 977), (pick + interval '4 hours')::date,
              split_part(pu, ',', 1), trim(split_part(pu, ',', 2)), 'ULSD',
              round((110 + random() * 60)::numeric, 1),
              round((380 + random() * 220)::numeric, 2), 2.50,
              round((382 + random() * 220)::numeric, 2), 'driver', 'open');
      insert into toll_transactions (company_id, driver_id, truck_id, transaction_id, tag_number,
                                     plaza_name, issued_date, amount, charge_to, status)
      values (cid, drv, trk, '14425' || (100000 + i * 331), 'B70103' || (40000 + i * 13),
              (array['Ohio Turnpike','Indiana Toll Road','Chicago Skyway','PA Turnpike','I-294 Illinois'])[1 + (i % 5)],
              (pick + interval '8 hours')::date, round((6 + random() * 26)::numeric, 2), 'driver', 'open');
    end if;
  end loop;

  -- ---------- ELD positions for the running trucks ----------
  for i in 1..10 loop
    insert into unit_locations (company_id, truck_id, lat, lng, speed_mph, heading, engine_state,
                                address_text, located_at, source, provider)
    values (cid, truck_ids[1 + (i % 26)],
            33.0 + random() * 10, -95.0 + random() * 12,
            round((random() * 68)::numeric, 0), floor(random() * 360),
            case when random() > 0.3 then 'On' else 'Off' end,
            'I-' || (20 + floor(random() * 60)::int) || ' near ' || cities[1 + floor(random()*20)::int],
            now() - (random() * 40) * interval '1 minute', 'api', 'samsara');
  end loop;

  -- ---------- 60 repair cases over the last 35 days ----------
  for i in 1..60 loop
    j := 1 + (i % 20);
    trk := truck_ids[1 + (i % 30)];
    drv := driver_ids[1 + (i % 26)];
    n_done := (i * 7) % 35;   -- days ago

    insert into repair_cases (company_id, title, description, unit_type, truck_id, driver_id,
                              priority, status, category, down_unit, vendor_id,
                              estimate_amount, location_text, created_at, reported_at, resolved_at)
    values (cid, case_titles[j],
            'Reported by driver. ' || case_titles[j] || ' — needs shop attention.',
            'truck', trk, drv,
            (array['critical','high','high','medium','medium','medium','low'])[1 + (i % 7)],
            case when n_done > 12 then (array['resolved','closed','resolved'])[1 + (i % 3)]
                 when n_done > 6  then (array['repair','awaiting_approval'])[1 + (i % 2)]
                 else (array['created','diagnostics','repair'])[1 + (i % 3)] end,
            case_cats[j],
            (i % 9 = 0),
            vendor_ids[1 + (i % 6)],
            round((180 + random() * 4200)::numeric, 2),
            cities[1 + (i % 30)],
            now() - (n_done || ' days')::interval,
            now() - (n_done || ' days')::interval,
            case when n_done > 12 then now() - ((n_done - 4) || ' days')::interval else null end)
    returning id into cs;

    insert into case_comments (case_id, company_id, body, kind, author_label, created_at)
    values (cs, cid,
            (array['Driver reported it in the truck group.',
                   'Booked into the shop for tomorrow morning.',
                   'Estimate received — waiting on approval.',
                   'Parts on order, back on the road in 2 days.',
                   'Confirmed on the pre-trip photos.'])[1 + (i % 5)],
            'comment',
            (array['Dispatch','Maintenance','Fleet','Safety'])[1 + (i % 4)],
            now() - (n_done || ' days')::interval + interval '3 hours');

    -- maintenance invoice for the finished ones
    if n_done > 12 then
      insert into maintenance_invoices (company_id, invoice_number, unit_type, truck_id, driver_id, vendor_id,
                                        in_date, out_date, payment_type, status, subtotal, tax, total,
                                        on_company_total, on_driver_total)
      values (cid, 'INV-' || (70000 + i * 13), 'truck', trk, drv, vendor_ids[1 + (i % 6)],
              (now() - (n_done || ' days')::interval)::date,
              (now() - ((n_done - 2) || ' days')::interval)::date,
              (array['efs','bank','credit_card'])[1 + (i % 3)], 'paid',
              round((180 + random() * 2600)::numeric, 2), 0, 0, 0, 0)
      returning id into inv;
      update maintenance_invoices set total = subtotal, on_company_total = subtotal where id = inv;
      insert into maintenance_tasks (invoice_id, company_id, description, quantity, unit_price, amount, charge_to)
      select inv, cid, case_titles[j], 1, m.subtotal, m.subtotal, 'company'
      from maintenance_invoices m where m.id = inv;
      update repair_cases set maintenance_invoice_id = inv where id = cs;
    end if;
  end loop;

  -- ---------- a few driver-charged deductions ----------
  for i in 1..14 loop
    insert into deductions (company_id, driver_id, truck_id, issued_date, charge_to, category,
                            description, amount, total, status)
    values (cid, driver_ids[1 + (i % 26)], truck_ids[1 + (i % 26)],
            current_date - (i * 2),
            'driver',
            (array['maintenance','drug_test','late_fee','missed_appointment','registration'])[1 + (i % 5)],
            (array['EFS-Repair-Midwest Diesel-INV-70213','Drug test','Late fee — load delivered 6h late',
                   'Missed appointment','2026/2027 + 2290'])[1 + (i % 5)],
            (array[450.00, 90.00, 250.00, 200.00, 2400.00])[1 + (i % 5)],
            (array[450.00, 90.00, 250.00, 200.00, 2400.00])[1 + (i % 5)], 'open');
  end loop;

  -- scheduled deduction runs due this week
  insert into recurring_deduction_runs (recurring_deduction_id, company_id, driver_id, run_date,
                                        period_start, period_end, amount)
  select r.id, cid, r.driver_id, current_date - 1, current_date - 8, current_date - 2, r.amount
  from recurring_deductions r where r.company_id = cid;

end $$;

-- ---------- what you got ----------
select 'drivers' as what, count(*) from drivers where company_id='11111111-1111-1111-1111-111111111111'
union all select 'trucks', count(*) from trucks where company_id='11111111-1111-1111-1111-111111111111'
union all select 'trailers', count(*) from trailers where company_id='11111111-1111-1111-1111-111111111111'
union all select 'assignments', count(*) from assignments where company_id='11111111-1111-1111-1111-111111111111'
union all select 'customers', count(*) from customers where company_id='11111111-1111-1111-1111-111111111111'
union all select 'loads total', count(*) from loads where company_id='11111111-1111-1111-1111-111111111111'
union all select '  running', count(*) from loads where company_id='11111111-1111-1111-1111-111111111111' and status='in_progress'
union all select '  completed+paid', count(*) from loads where company_id='11111111-1111-1111-1111-111111111111' and status='completed'
union all select '  invoiced unpaid', count(*) from loads where company_id='11111111-1111-1111-1111-111111111111' and status='payment_pending'
union all select '  not invoiced', count(*) from loads where company_id='11111111-1111-1111-1111-111111111111' and status='delivered'
union all select 'repair cases', count(*) from repair_cases where company_id='11111111-1111-1111-1111-111111111111'
union all select 'invoices', count(*) from invoices where company_id='11111111-1111-1111-1111-111111111111';

-- ---------- PM schedules + odometer trail (so the unit Service bar has data) ----------
do $$
declare cid uuid := '11111111-1111-1111-1111-111111111111'; t record; i int := 0; base int;
begin
  for t in select id from trucks where company_id = cid order by unit_number loop
    i := i + 1;
    base := 180000 + (i * 14300);
    insert into pm_schedules (company_id, unit_type, truck_id, name, kind, interval_miles, last_done_odometer, last_done_date)
    values (cid, 'truck', t.id, 'PM Service', 'pm', 25000, base, current_date - (20 + i));
    insert into odometer_readings (company_id, truck_id, reading, source, recorded_at)
    values (cid, t.id, base + (case when i % 6 = 0 then 26800 else 9000 + (i * 640) end), 'eld', now() - interval '2 hours');
  end loop;
end $$;
