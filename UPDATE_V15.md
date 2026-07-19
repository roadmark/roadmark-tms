# Demo v15 — Full demo dataset · Timeline dispatch board · Menu restructure

## 1. Real-size demo data

`samples/demo_data_large.sql` builds a fleet you can actually judge the app on:

| | |
|---|---|
| Drivers | **26** (mixed company / owner / rent / lease-to-buy / contractor) |
| Trucks | **30** · Trailers **35** · all 26 drivers assigned a rig |
| Customers | 12 brokers · 6 repair vendors |
| Loads | **70** — **10 running now**, **45 completed and paid**, **5 invoiced still unpaid**, **10 delivered not yet invoiced** |
| Repair cases | **60** across the last 35 days, every priority and status |
| Also | 50 invoices, fuel + tolls on 30 loads, driver deductions, weekly truck rent + ELD schedules, live ELD positions on the running trucks |

**This replaces the demo company's operational data** (your login, company and any other
company are untouched). Run it once in the SQL Editor — it prints a table of counts at the
end so you can confirm.

## 2. Dispatch board — rebuilt as a timeline

Matched to what you showed me, in Roadmark colours:

- **KPI strip** across the top: total/covered drivers, loads, dispatchers · gross, driver
  pay with %, difference · total/empty/loaded miles · RPM (total and loaded), MPL, GPD, MPD
  · rate per mile broken down by equipment type.
- **Filters**: search across driver, truck and trailer · dispatcher · driver type · load
  status · and a 5/7/10/14-day range switch.
- **Date navigation** with ‹‹ ‹ › ›› and a Today button; today's column is highlighted,
  weekends shaded, and a live **"now" line** runs down the board.
- **Driver panel** on the left, sticky while you scroll sideways: name, email, status,
  driver type, phone, dispatcher, assigned truck and trailer, plus Gross / Driver rate /
  Total miles / RPM. The **⧉ button copies** the whole contact block to your clipboard,
  and **▾ all loads** expands the driver's loads for the range.
- **Load bars** spanning pickup → delivery across the date columns, coloured by status
  (blue running, green delivered, amber scheduled, red TONU). Each shows the load number,
  broker reference, origin and destination state + city with a connecting line, empty and
  loaded miles, weight, freight, difference and rate per mile. Overlapping loads stack
  into lanes instead of colliding.
- **Click any bar** for the full load detail panel; **Notes column** on the right lists the
  load numbers for that driver.

## 3. Menu in your order

```
Overview
Dispatch    Board · Loads · Trip activity · Customers
Accounting  Loads · Settlements
Safety      Drivers · Insurance · Compliance
Fleet       Trucks · Trailers · Maintenance history · Maintenance vendors
Admin       Repair cases · Assignments · Live map · Invoices · Payroll ·
            Assistants · Company & users · ELD · Telegram · Broker email
```

New in this restructure:
- **Accounting → Loads** — the money view: rate per total and loaded mile, freight, driver
  rate, difference, invoice number and balance, accounting note, with clickable status
  cards (All / Ready for invoicing / Open deliveries / Payment pending / Completed) and a
  **Σ totals row**.
- **Accounting → Settlements** — now a hub with sub-tabs: Overview · Statements · Fuel ·
  Tolls · Deductions · Scheduled · Credit · Balance due.
- **Fleet → Trucks** and **Trailers** are separate pages now.
- **Maintenance vendors** — new page with invoice count and total spend per shop.

## Update steps

**1.** Extract the zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all).

**2. Load the demo data** — SQL Editor → paste `samples/demo_data_large.sql` → Run.
(Skip if you'd rather keep what you have; everything else works either way.)

**3.** Push:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Demo dataset, timeline board, menu restructure"
git push
```

No `npm install`, no new migrations.

## Try it
1. **Dispatch → Board** — you should see 26 drivers with bars across the days. Switch to
   14d, hit Today, click a bar, copy a driver with ⧉.
2. **Accounting → Loads** — click "Payment pending" (5 loads) then "Completed" (45).
3. **Admin → Repair cases** — 60 cases; the board fills with colour by priority.
