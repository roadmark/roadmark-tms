# Demo v19 — Driver detail, compliance chips, count strips

## Driver detail page

Click any driver row and you get their own page with five tabs:

**Overview** — four cards, matching the layout you showed me:
- *Personal info*: status, type, SSN (masked), phone, email, address, date of birth, hire
  date, note. If your role can't see the private file, it says so rather than showing blanks.
- *Assignment*: truck, trailer, since when, dispatcher, co-driver, and the **last load** as
  a route card with miles, freight, driver rate and $/mi.
- *Payment info*: pay type and rate, deduct fuel / tolls, fuel discount share, bank routing
  and account (masked), payout method.
- *Legal info*: CDL number, class and state, endorsements, their own company name, EIN and
  address, recruiter, emergency contact.

**Compliances** — every item with start and end dates, days left or days overdue, status
and the attached document. **+ Add compliance** with file upload.

**Recurring deductions** — each schedule as a card: amount, frequency and which day it runs,
**accumulated so far** across all runs, and a progress bar for fixed-term ones like escrow
(4/10). Notes that processing happens daily at 13:00 UTC.

**Loads** — every load with route, miles, freight, driver rate and $/mi, plus totals.

**Settlements** — every statement with the full bucket breakdown and net pay.

## Chips in the lists

- **Drivers** and **Trucks/Trailers** now show **compliance chips** on each row — CDL, MED,
  MVR, REG, INSP and so on, coloured red when expired, amber when expiring, grey when
  valid, with an `x2` badge counting the problems. Bad ones sort first, so a row with a
  problem reads at a glance.
- **Loads** now show **document chips** — RC, POD, BOL, LMP — so you can see instantly
  which loads are missing paperwork.

## Count strips

Drivers and Trucks/Trailers have the **Status / Type / Ownership breakdown bar** above the
table, with counts and percentages. **Click any line to filter** the list, click again to
clear.

## Update steps

**1.** Extract over `C:\TRUCKWRENCH\roadmark-tms` (Replace all).

**2. Re-run the demo data** if you want the chips populated —
`samples/demo_data_large.sql` now also creates compliance items for every driver
(CDL, MED, MVR, DT, CH, W-9) and truck (REG, INSP, 2290), with a handful deliberately
expired or expiring so the chips have something to say.

**3.** Push:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Driver detail, compliance chips, count strips"
git push
```

No `npm install`, no new migrations.

## Try it
1. Safety → **Drivers** — count strip on top, compliance chips on each row. Click a red
   chip's row to open that driver → Compliances tab.
2. Click **Status → Active** in the count strip to filter, click again to clear.
3. Driver → **Recurring deductions** — truck rent and ELD device with accumulated totals.
4. Dispatch → **Loads** — the Docs column. Loads created from a scanned rate con show RC.
