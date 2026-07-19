# Demo v8 — Invoicing & Office Payroll (~5 min)

The money cycle is now complete in both directions: **bill the brokers**, **pay the staff**.
Two new tabs under Accounting.

## Accounting · Invoices (accounts receivable)

- **Invoice delivered loads** — lists every delivered load that doesn't have an invoice
  yet, with amount, customer, delivery date and payment terms. Tick the ones to bill
  (or Select all) and it creates one invoice per load, numbered from the load number.
  Loads sitting at "delivered" move to "invoiced" automatically.
- **Aging at a glance** — Outstanding, 0–30, 31–60, 61+ days, computed from open balances.
- **Open an invoice** to mark it sent or factored, and to **record payments** — including
  **short pay** and **over pay**, which brokers do constantly. Recording a payment updates
  the balance and status (partial → paid / short_paid), and paying in full marks the load
  **completed**, closing the loop that started with the rate confirmation.
- Void anything entered by mistake; Export CSV for the whole list.

## Accounting · Payroll (office staff)

- **Office staff** tab: add dispatchers, accounting, safety, fleet and maintenance staff
  with their department, position, and pay agreement (monthly, weekly, biweekly, hourly,
  per-load or percentage). Two counters show active headcount and fixed monthly cost.
- **Payroll runs**: pick the period and every active employee is prefilled from their
  agreement — monthly/weekly/biweekly compute automatically; hourly, per-load and
  percentage agreements come in at $0 with your agreement note displayed, so you enter the
  calculated figure.
- Edit **base, bonus, reimbursement, deduction** per person — net and run totals update as
  you go. Then **Approve** (locks the figures), **Mark paid** (stamps the date on every
  line), or reopen. **Export CSV** for the bank transfer file.

## Update steps

Extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Invoicing and office payroll"
git push
```

No `npm install`, no Supabase changes.

## Try it

**Invoicing** — Accounting → Invoices → **Invoice delivered loads**. Load #3 (Memphis →
Columbus, $2,100) should be waiting. Create the invoice, open it, **Mark sent**, then
record a payment of $2,050 with a **$50 short pay** — status becomes *short paid*, balance
zero, and load #3 flips to *completed*. Check the aging strip before and after.

**Payroll** — Accounting → Payroll → **Office staff** → add two people, e.g. a dispatcher
at $4,200/month and an accountant at $3,800/month. Switch to **Payroll runs** → **New
payroll run** → this month → create. Both are prefilled; add a $300 bonus to one, watch
the net and run total move, then Approve and Mark paid.
