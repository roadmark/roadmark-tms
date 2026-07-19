# Demo v5 — Fuel & Toll CSV Import (~8 min)

**What's new — the Accounting page is now tabbed: Overview · Fuel · Tolls · Deductions**

- **Import fuel CSV / Import toll CSV** — drop the statement your provider emails you
  (EFS, Comdata, WEX, Bestpass, EZPass…). Your column names do **not** need to match
  ours: a mapping screen lets you match them once, guesses most of it automatically, and
  remembers your choices for next time.
- **Automatic driver & unit matching** — fuel rows match by card number (via Fuel Cards)
  or unit number; toll rows match by transponder tag, plate, or unit number. The truck
  then resolves to whoever is currently assigned to it. Anything it matched shows the
  driver already filled in; anything it didn't shows a "suggest:" hint in the dropdown.
- **"Accept N suggested drivers"** — one click assigns every suggested match.
- **Duplicate protection** — importing the same statement twice skips rows already
  stored (same transaction ID + date). Try it: import the sample file twice.
- **Open balances by driver** on the Overview tab, and **Export CSV** on every table.

## Update steps

**1.** Extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all).

**2. This version adds a new library, so install it** (new step — only needed this time):

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
npm install
```

**3.** Push:

```powershell
git add -A
git commit -m "Fuel and toll CSV import"
git push
```

No Supabase changes. Vercel redeploys in ~2 minutes.

## Try it — sample files included

The `samples/` folder in this zip has two test statements that match your demo data,
with deliberately different column headings (Trans Date, Card #, Net Amount…) so you can
see the mapping screen do its job:

1. Accounting → **Fuel** tab → **Import fuel CSV** → pick
   `samples/sample_fuel_statement.csv`.
2. Check the mapping screen — it should have matched most columns already. Fill any
   marked `*`. The preview says how many rows are ready and how many matched a driver.
3. Import. Marcus (truck 4114) and Sofia (7273) rows come in with drivers attached;
   the 3547 rows attach to whoever you assigned to it.
4. Import the **same file again** → every row is skipped as a duplicate.
5. Repeat with **Tolls** → `samples/sample_toll_statement.csv` (matches by plate).
6. Overview tab: fuel and toll totals per driver have moved.

Then try a **real statement** from your provider — that's the true test of the mapping
screen. If a column doesn't map cleanly, tell me its heading and I'll add it to the
auto-guess list.
