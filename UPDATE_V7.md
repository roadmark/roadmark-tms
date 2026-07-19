# Demo v7 — Compliance & Insurance (~6 min)

Safety is now a full module. Two new pages in the sidebar plus an alert panel on Overview.

## What's new

**Safety · Compliance** — tabs for drivers / trucks / trailers.
- Track every document with an expiry: CDL, medical card, MVR, drug test, clearinghouse,
  registration, annual inspection, 2290 and the rest (15 standard types are pre-loaded).
- Four counters at the top: **Expired · Expiring (30 days) · Missing date · Valid**, and
  the table can be filtered to each.
- Adding an item with a known validity period (e.g. medical card = 2 years) fills in the
  expiry date from the issue date automatically.
- Attach the actual document — it lands in the document registry and opens with one click.
- Status is computed from the date every time you load the page, so it's never stale.

**Safety · Insurance**
- Policies for all nine coverage types (AL, Cargo, PD, GL, Bobtail, WC, Occ/Acc, TI, Other)
  with insurer, term, premium, monthly installment, limits, deductible and agent.
- Open a policy to **enroll** trucks, trailers and drivers on it, each with a monthly cost
  and a **driver-paid** flag. The list shows how many units are on each policy and the
  total monthly cost.
- Removing an enrollment keeps history (it records the removal date rather than deleting).

**Overview → "Compliance needing attention"** — anything expired or expiring within 30
days, with a days-left / days-overdue badge. This is exactly the list the reminder bot
will read when it goes live, to tag the driver and safety in the truck group.

## Update steps

Extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Compliance and insurance"
git push
```

No `npm install`, no schema changes.

## Optional: sample data

To see the screens populated immediately, run `samples/demo_compliance_seed.sql` in the
Supabase SQL Editor (paste the whole file, Run). It adds 9 compliance items — deliberately
including Marcus's medical card expiring in 14 days, his MVR in 5 days, Sofia's drug test
35 days overdue, and truck 4114's inspection in 15 days — plus an Auto Liability policy
with both trucks enrolled (4114 driver-paid at $685/mo) and a Cargo policy.

Then check Overview: the "Compliance needing attention" panel lists them by urgency.

## Try it
1. Safety · Compliance → drivers tab → the counters show 1 expired, 2 expiring.
2. Filter to **expiring** → open Marcus's medical card → attach a photo/PDF → save →
   the Document column now has an **Open** button.
3. Switch to the **trucks** tab → 4114's annual inspection is expiring.
4. Safety · Insurance → open the AL policy → see both trucks enrolled, one driver-paid →
   enroll a trailer or driver to try it.
5. Overview → the alert panel reflects all of it, sorted by soonest.
