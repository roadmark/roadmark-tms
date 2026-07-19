# Demo v14 — Roadmark Design + Cases (repair management)

Two things: the app now looks like Roadmark, and it gained the Cases workflow from
Roadmark Fleet Management — including uploading the repair invoice.

## 1. Roadmark design

Matched to the screenshots you sent:
- **Dark by default** (#0d0f13 surfaces) with the **amber accent** on active nav, primary
  buttons and segmented tabs; the Roadmark orange dot in the wordmark.
- **Sidebar rebuilt** the Roadmark way: user card with avatar initial and role in small
  caps at the top, then grouped sections — **Work · Fleet · Money · Safety · Admin**.
- **Status pills** in the Roadmark style (coloured dot + uppercase label) with the same
  colour language: green running, blue in-shop/diagnostics, amber needs-service/repair,
  purple awaiting-approval, red critical.
- **Segmented tab pills** (Trucks/Trailers, accounting tabs, payroll views) instead of
  button rows.
- **Theme toggle** in the header — dark or light, remembered per browser.
- **Notifications bell** with unread count, reading the notifications table.
- Map tiles are dimmed in dark mode so the truck markers stay readable.

Nothing about the data or permissions changed; every screen inherits the new tokens.

## 2. Cases — repair management

New **Fleet → Cases** page, board and list views.

- **Board** shows a card per case, bordered by priority (critical red, high amber, medium
  blue, low grey): unit chip, title, status and category, the **last comment**, and how
  long it's been open — the same at-a-glance layout as Roadmark.
- **Open a case** when a driver reports a problem: unit, driver (auto-filled from the
  current assignment), priority, category, whether the unit is **down**, estimate, location.
- **Status workflow** — Created → Diagnostics → Awaiting approval → Repair → Resolved →
  Closed. Every change is logged to the case activity automatically.
- **Comments** — anyone in the company can post; status changes and attachments appear in
  the same thread.
- **Upload the repair invoice** on the case. The AI reads it, creates the maintenance
  invoice against that unit with all its line items, attaches the file to both records,
  links it back to the case and marks the case **resolved**. You then set the On Company /
  On Driver split under Maintenance as usual — and driver-charged amounts still become a
  deduction.
- KPI strip: open cases, units down, critical, high, resolved. Filters by scope and priority.

Cases are editable by maintenance, fleet, dispatch and safety — a problem can be reported
by whoever hears about it first.

## Update steps

**1. Database** — SQL Editor → run `supabase/migrations/015_cases.sql`.

**2. Code**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Roadmark design + repair cases"
git push
```

No `npm install` needed.

**3. Optional sample cases** — run `samples/demo_cases_seed.sql` to fill the board with
five realistic cases (reefer down, engine derate awaiting approval, brakes in diagnostics,
air leak, broken lens) with comments.

## Try it
1. **Fleet → Cases** — the board with coloured priority borders.
2. Open the reefer case → move it through statuses → watch each change appear in Activity.
3. Post a comment → it shows on the card as "Last comment".
4. Open a case and **upload a real repair invoice** → maintenance invoice created, case
   resolved, both linked.
5. Header **☀/☾** to switch light and dark.

## Still open from the gap analysis

Done here: notifications bell, theme toggle, Roadmark styling, plus Cases.
Next, in the order I'd do them: **document chips in the loads table**, **compliance chips
on driver and unit rows**, **count strips with percentages** on list headers (the CSS is
already in place — `.countbar`), **per-column filters and Σ totals rows**, then **detail
pages with tabs** for driver/truck/trailer, and **cross-company views**.
