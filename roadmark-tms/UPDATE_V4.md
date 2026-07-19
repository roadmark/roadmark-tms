# Demo v4 — Assignments + Multi-stop Loads (~5 min, no function redeploy)

**What's new**

**1. Assignments page** (sidebar → Fleet · Assignments)
- Pair driver ↔ truck ↔ trailer. Only unassigned people/equipment are listed, so you
  can't double-book a truck — one active assignment per driver, truck and trailer.
- **End** an assignment when equipment changes hands; the record moves to history
  (Show history) and is never deleted.
- Fleet and dispatch can both manage assignments; everyone can view them.

**2. Loads know the equipment**
- Picking a **driver** on a load now auto-fills their currently assigned **truck and
  trailer**. Override any time — it's a starting point, not a lock.

**3. Multi-stop loads**
- Open any load → new **Stops** section: add pickups and deliveries in order, each with
  city/state, facility name, Appointment vs FCFS, and scheduled time.
- The load's route line and the **"(+2)" multi-stop label** update themselves from the
  stops — the same behavior your old software had.
- Rate cons scanned by AI now store **every stop** they contain, not just the first
  pickup and last delivery.

## Update steps

Extract this zip over `C:\TRUCKWRENCH\roadmark-tms` (Replace all), then:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Assignments + multi-stop loads"
git push
```

No Supabase changes this time — the tables and rules were already in place from the
migrations. Vercel redeploys in ~2 minutes.

## Try it
1. **Fleet · Assignments → New assignment**: Devon Carter + truck 3547. Notice Marcus and
   Sofia aren't listed — they're already assigned.
2. **Loads → New load** → pick driver Marcus Bell → truck 4114 and trailer D050065 fill
   themselves in.
3. Open load #1 → **Stops** → add a second delivery (e.g. Batavia, NY) → close and look
   at the table: the delivery cell now reads "… (+1)".
