# Demo v24 — Map layers organised the Roadmark way

Your screenshot showed me what `shop_type` actually means, and I had it wrong:
**`chain` is a truck-stop brand** (Love's/Speedco, TA/Petro, Southern Tire Mart,
Goodyear, Boss) — **independent / mechanic / community are the ★ Recommended list**.
The map now groups exactly like Roadmark's.

## What changed

**Layer tree** — a **☰ Layers** button opens the same structure you have in Roadmark:

```
☑ Select all
★ Recommended                278     ← amber, starred pins, drawn larger
☑ Truck stops ▾            1,453     ← red
     ☑ Love's / Speedco        …
     ☑ TA / Petro              …
     ☑ Southern Tire Mart      …
     ☑ Boss Truck Stop         …
☑ Parking                  6,755     ← blue
☑ Weigh stations                     ← purple (when present)
─────────────
☑ Our pins
☑ Our trucks
☐ Preferred only
```

Truck stops expand into **brand sub-checkboxes** so you can show only Love's, or hide
the chains entirely and see just the recommended shops.

**Colours now follow Roadmark's legend** — amber recommended, red truck stops, blue
parking, purple weigh stations, yellow CAT scales. **★ Recommended pins are drawn larger
with a star**, so they stand out from 6,755 parking dots the way they do in your app.

**Quick chips** beside the Layers button show the three headline counts at a glance, and
popups now read "★ Recommended · Tires" or "Love's / Speedco · Truck stop".

## Update steps

**1. Database** — SQL Editor → run `supabase/migrations/017_map_categories.sql`
(adds `shop_type`, `brand`, `is_recommended`).

**2. Code + function**

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Roadmark map layer grouping"
git push
npx supabase functions deploy map-sync
```

**3. Re-sync** so the existing 8,491 pins pick up their brand and recommended flag —
Live map → **Sync Roadmark**. It upserts, so nothing is duplicated.

**4. Check it landed:**

```sql
select is_recommended, kind, count(*) from map_places
where source='roadmark' group by 1,2 order by 3 desc;

select brand, count(*) from map_places
where kind='truck_stop' group by 1 order by 2 desc limit 10;
```

You should see ~278 recommended and the brand breakdown matching Roadmark's panel.

## Not carried over yet

**CAT scales, weather and traffic** are live layers in Roadmark rather than stored rows,
so they aren't synced. Weigh stations will appear as a layer if they're in a table you
point the sync at — tell me the table name and I'll add it to the invoke body.
