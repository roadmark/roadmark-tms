-- 010_finalize.sql — views, updated_at + audit triggers, realtime, cron jobs

-- ============================================================ updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['companies','profiles','company_settings','drivers','driver_private',
    'employees','employees_private','compliance_items','trucks','trailers','vendors',
    'maintenance_invoices','pm_schedules','customers','loads','extraction_jobs','invoices',
    'deductions','recurring_deductions','escrow_accounts','settlements','payroll_runs',
    'insurance_policies','telematics_connections','telematics_units']
  loop
    execute format('drop trigger if exists trg_touch_%I on %I', t, t);
    execute format('create trigger trg_touch_%I before update on %I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================ audit triggers on key tables
do $$
declare t text;
begin
  foreach t in array array['loads','drivers','driver_private','trucks','trailers','assignments',
    'maintenance_invoices','deductions','recurring_deductions','credits','settlements',
    'invoices','payroll_runs','payroll_lines','insurance_policies','company_members',
    'fuel_transactions','toll_transactions','employees']
  loop
    execute format('drop trigger if exists trg_audit_%I on %I', t, t);
    execute format('create trigger trg_audit_%I after insert or update or delete on %I
                    for each row execute function app.write_audit()', t, t);
  end loop;
end $$;

-- ============================================================ business views

-- open balances per driver (the Settlements Overview strip)
create or replace view v_driver_balances as
select
  d.company_id,
  d.id as driver_id,
  d.full_name,
  d.status,
  coalesce((select sum(total) from fuel_transactions f
            where f.driver_id = d.id and f.status='open' and f.charge_to='driver'),0) as fuel_open,
  coalesce((select sum(amount) from toll_transactions t
            where t.driver_id = d.id and t.status='open' and t.charge_to='driver'),0) as tolls_open,
  coalesce((select sum(total) from deductions x
            where x.driver_id = d.id and x.status='open' and x.charge_to='driver'),0) as deductions_open,
  coalesce((select sum(amount) from recurring_deduction_runs r
            where r.driver_id = d.id and r.status='open'),0) as scheduled_open,
  coalesce((select sum(amount) from credits c
            where c.driver_id = d.id and c.status='open'),0) as credits_open,
  coalesce((select sum(amount) from balance_dues b
            where b.driver_id = d.id and b.status='open'),0) as balance_due_open
from drivers d;

-- per-load profitability
create or replace view v_load_profit as
select
  l.id, l.company_id, l.load_number, l.status, l.customer_id, l.dispatcher_id, l.driver_id,
  l.freight_amount, l.driver_rate,
  (l.freight_amount - l.driver_rate) as difference,
  l.loaded_miles, l.empty_miles, l.total_miles,
  case when l.total_miles > 0 then round(l.freight_amount / l.total_miles, 2) else 0 end as rate_per_total_mile,
  case when l.loaded_miles > 0 then round(l.freight_amount / l.loaded_miles, 2) else 0 end as rate_per_loaded_mile
from loads l;

-- compliance items that need attention (expired or expiring in 30 days)
create or replace view v_compliance_alerts as
select ci.*, ct.code, ct.name as compliance_name, ct.applies_to
from compliance_items ci
join compliance_types ct on ct.id = ci.compliance_type_id
where ci.status in ('expired','expiring','missing')
   or (ci.expiry_date is not null and ci.expiry_date <= current_date + 30);

-- ============================================================ nightly status refresh
create or replace function app.refresh_expiry_statuses() returns void
language plpgsql security definer set search_path = public as $$
begin
  update compliance_items set status='expired'
    where expiry_date is not null and expiry_date < current_date and status <> 'expired';
  update compliance_items set status='expiring'
    where expiry_date is not null and expiry_date >= current_date
      and expiry_date <= current_date + 30 and status = 'valid';
  update insurance_policies set status='expired'
    where end_date is not null and end_date < current_date and status not in ('expired','cancelled');
  update insurance_policies set status='expired_soon'
    where end_date is not null and end_date >= current_date
      and end_date <= current_date + 30 and status = 'active';
end $$;

-- ============================================================ recurring deductions daily processor
-- (runs daily; creates recurring_deduction_runs for schedules due "today")
create or replace function app.process_recurring_deductions() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; due boolean;
begin
  for r in select * from recurring_deductions
           where status = 'active' and start_date <= current_date
             and (end_date is null or end_date >= current_date)
             and (max_occurrences is null or occurrences_done < max_occurrences)
  loop
    due := false;
    if r.frequency = 'weekly' and extract(dow from current_date) = coalesce(r.anchor_dow,1) then
      due := true;
    elsif r.frequency = 'biweekly' and extract(dow from current_date) = coalesce(r.anchor_dow,1)
      and (floor((current_date - r.start_date) / 7.0)::int % 2 = 0) then
      due := true;
    elsif r.frequency = 'monthly' and extract(day from current_date) = coalesce(r.anchor_dom,1) then
      due := true;
    end if;

    if due then
      insert into recurring_deduction_runs
        (recurring_deduction_id, company_id, driver_id, run_date,
         period_start, period_end, amount)
      values
        (r.id, r.company_id, r.driver_id, current_date,
         case r.frequency when 'weekly' then current_date - 7
                          when 'biweekly' then current_date - 14
                          else (current_date - interval '1 month')::date end,
         current_date - 1, r.amount)
      on conflict (recurring_deduction_id, run_date) do nothing;

      if found then
        update recurring_deductions
          set occurrences_done = occurrences_done + 1,
              status = case when max_occurrences is not null
                             and occurrences_done + 1 >= max_occurrences
                            then 'completed' else status end
          where id = r.id;
        -- escrow schedules also feed the escrow account
        if r.is_escrow then
          insert into escrow_accounts (company_id, driver_id, target_amount, balance)
          values (r.company_id, r.driver_id, coalesce(r.max_occurrences,0) * r.amount, 0)
          on conflict (company_id, driver_id) do nothing;
        end if;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;

-- ============================================================ cron (enable pg_cron in Dashboard -> Database -> Extensions first)
create extension if not exists pg_cron;

select cron.schedule('recurring-deductions-daily', '0 13 * * *',  -- 1 PM UTC daily
  $$select app.process_recurring_deductions()$$);

select cron.schedule('expiry-status-nightly', '30 6 * * *',
  $$select app.refresh_expiry_statuses()$$);

select cron.schedule('prune-locations', '15 7 * * *',
  $$delete from unit_locations where located_at < now() - interval '30 days' and source = 'api'$$);

-- ============================================================ realtime publication
-- Add the tables the UI subscribes to. (Supabase creates the publication automatically.)
do $$
declare t text;
begin
  foreach t in array array['loads','load_stops','check_calls','drivers','trucks','trailers',
    'assignments','maintenance_invoices','maintenance_tasks','deductions','credits',
    'fuel_transactions','toll_transactions','recurring_deduction_runs','settlements',
    'documents','extraction_jobs','notifications','compliance_items','insurance_policies',
    'customers','company_members']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
