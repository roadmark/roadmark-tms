# Demo v6 — Settlement Run (~5 min, no Supabase changes)

The demo can now process a full pay week: **Accounting → Settlements**.

## What it does

**New settlement run** → pick the period and cutoff date → the app gathers, per driver:
- delivered/invoiced/completed **loads** not yet settled (driver pay) — plus
- **credits**, minus **fuel**, **tolls**, **deductions**, **scheduled deductions**
  (truck rent etc.) and any **balance forward** from a previous negative week.

It shows a preview per driver with the net, then creates **draft** statements — nothing
is charged or closed yet.

**Open a draft** to see every line grouped by bucket. You can **remove a line** (that
charge simply stays open and lands on next week's statement instead). Then:

- **Approve** — stamps this statement on every source record and closes them, so they
  can never be paid twice. If the net is **negative**, the shortfall automatically
  becomes a **balance due** carried into next week, and net pay is set to 0.
- **Mark paid** — records the payment date.
- **Void** — reopens every line and removes any balance due it created. Nothing is ever
  lost.
- **Export CSV** — the statement lines, for your records or the bank file.

Items older than the period are included too (anything still open on or before the
cutoff), so a charge that was missed last week is never dropped.

## Update steps

Extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Settlement run"
git push
```

No `npm install` needed this time, and no Supabase changes.

## Try it — expected numbers

With the demo seed data (plus anything you've added), run a settlement with the cutoff
set to **today**:

- **Marcus Bell** — 1 load $1,848.00 + credits $140.00 − fuel $922.65 − tolls $11.31
  − deductions $450.00 (the repair) − scheduled $750.00 (truck rent) = **−$145.96**
- **Sofia Petrov** — no delivered loads yet, − fuel $31.02 − tolls $8.90 = **−$39.92**

(If you imported the sample fuel/toll CSVs in v5, the fuel and toll numbers will be
higher — the math still holds.)

Now walk the full cycle:
1. Create the drafts, open Marcus's statement, look at the lines by bucket.
2. **Approve** it → because the net is negative, a balance due of $145.96 is created for
   next week, and net pay becomes $0.
3. Check **Accounting → Overview**: his fuel/tolls/deductions dropped to zero (they're
   closed) and **Balance due $145.96** appeared.
4. Run a **second settlement** for next week — the balance forward line is right there.
5. Open the approved statement and **Void** it → everything goes back to open and the
   balance due disappears. Nothing is destructive.

That negative week is a realistic scenario (big repair + truck rent against one load) and
it exercises the whole carry-forward path. Add a couple of delivered loads for Marcus and
re-run to see a positive statement.
