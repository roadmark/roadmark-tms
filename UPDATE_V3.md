# Demo v3 — Repair Invoice AI + Full Maintenance Editor (~10 min)

**What's new on the Maintenance page:**
- **"📄 New from invoice (AI)"** — drop a repair shop invoice (PDF/photo). AI reads the
  vendor, invoice #, date, unit number, odometer, totals, and **every task line item**.
  If the vendor is new, it's created automatically; the unit number auto-matches your
  trucks/trailers.
- **Full invoice editor** — header, task lines with qty/price/amount, and the key
  control: **On Company / On Driver per task**. Subtotal, tax, fees, and both split
  totals compute live (tax & fees go on company).
- **Auto deduction** — if any tasks are On Driver and a driver is selected, saving
  creates the driver deduction automatically, named the standard way
  (`EFS-Repair-{Vendor}-{Invoice#}`), linked to the invoice. Check Accounting →
  Recent deductions after saving — it's there, and it will flow into settlements.
- Click any existing invoice row to open and edit it (tasks included).

## Update steps

**1. Code** — extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Repair invoice AI + maintenance editor"
git push
```

**2. Function** — the AI function gained the repair-invoice reader, so redeploy it once:
- **If you used the browser editor:** Edge Functions → extract-document → open the
  editor → select all, delete → paste the new
  `supabase/functions/extract-document/index.ts` from this zip → Deploy.
- **If you used the CLI:** `npx supabase functions deploy extract-document`

(The secret stays — no need to re-add ANTHROPIC_API_KEY.)

**3. Try it** — Maintenance → "New from invoice (AI)" → drop a real shop invoice.
Review the tasks, flip the driver-caused ones to **On Driver**, pick the driver, Save.
Then open Accounting: the deduction is in Recent deductions and the driver's open
balance moved.

## Troubleshooting
Same as before — the definitive answers are in Edge Functions → extract-document →
Logs, and in SQL:
`select status, error from extraction_jobs order by created_at desc limit 3;`
