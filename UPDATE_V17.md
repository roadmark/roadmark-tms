# Demo v17 — Menu order, Trucks/Trailers fix, and Unit detail pages

## Fixed
- **Menu order** as you asked: Fleet now leads with **Repair cases → Assignments →
  Trucks → Trailers → Maintenance history → Maintenance vendors**. Accounting gained
  **Invoices, Payroll and Company & users**. Admin keeps Live map, Assistants, ELD,
  Telegram and Broker email.
- **Trucks / Trailers now switch properly.** Both menu items rendered the same component,
  so React kept the old tab. The route now drives the tab, and the on-page Trucks/Trailers
  switcher updates the URL too — so it works from the sidebar or the page.

## New — Fleet Data detail pages

Click any truck or trailer row and you get its own page with tabs
(the **Edit** button on the row still opens the quick edit form):

**Overview** — unit info (status, VIN, type, ownership, note) · **Service** progress bar
for trucks showing cycle start, next service, current odometer and a coloured bar with
"x mi to PM" or overdue · **Assignment** (driver, type, phone, since) · **Last load** as a
route card with miles, freight, weight and $/mi · **Vehicle details** (make, model, year,
plate, state, registrant, toll device) · **Lease / rent info**.

**Compliances** — every item with start/end dates, days left or days overdue, status, note
and the attached document (one click to open). **+ Add compliance** with file upload.

**Maintenance** — every repair invoice for this unit with vendor, driver, status and the
On Company / On Driver split, plus lifetime spend.

**Cases** — **active repairs highlighted** at the top in amber, previous repairs listed
below, each with priority, status, category, vendor, estimate and resolution date.

**Condition** — photo grid for equipment condition; upload several at once (handover
photos, damage, tyres), click to open.

## Update steps

**1.** Extract over `C:\TRUCKWRENCH\roadmark-tms` (Replace all).

**2.** If you want the Service bars populated, re-run `samples/demo_data_large.sql` — it
now also creates a PM schedule and an odometer reading per truck (a few will read
overdue, which is what you want to see).

**3.** Push:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Menu order, unit detail pages"
git push
```

No `npm install`, no new migrations.

## Try it
1. Fleet → **Trucks**, then **Trailers** — they switch now.
2. Click a truck → Overview with the service bar → Cases tab (active repairs in amber) →
   Condition → upload a photo.
