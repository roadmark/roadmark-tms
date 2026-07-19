# Demo v26 — Full redesign against Roadmark

The TMS now uses Roadmark's own visual language rather than an approximation of it.

## Colour

Rebuilt on **#17181c** — the exact `theme_color` from Roadmark's manifest — with the
app background one step darker (#0f1013) and panels stepping up from there. The amber is
matched to your buttons and active nav (#f4a52a), and the logo dot uses your orange-red
(#ff5c39). Every status colour now matches Roadmark's cases board: red critical, amber
high/repair, blue diagnostics/in-shop, violet awaiting-approval, green running.

Light mode is rebuilt to match rather than being a rough inversion.

## Chrome

- **Sidebar collapses** to a 62px icon rail (« Collapse at the bottom, remembered between
  visits) — the same control Roadmark has.
- **Theme is a two-button pill** (☀ / ☾) like Roadmark's header, not a single toggle.
- **Company switcher is a rounded chip** with your avatar on the right.
- **Search is a pill** in the header.
- Scrollbars, focus rings, map controls and Leaflet popups all follow the token set, so
  nothing looks bolted on.

## Page patterns

- **Page headers** are now `Title · 26 drivers · 24 active` — the inline stat line
  Roadmark uses, instead of a row of large KPI cards eating the top of every screen.
  Applied to Cases, Trucks, Trailers, Drivers and Loads.
- **Filter pills carry counts** — `Open 14 · Units down 3 · Resolved 46` — matching
  Roadmark's `No driver · 62` pattern.
- **Table rows have hover action icons** (↗ open, ✎ edit) at the right edge instead of
  a permanent button, so the eye follows the data rather than the controls.
- Denser type throughout: 13.5px base, tighter table padding, smaller uppercase labels —
  closer to how much Roadmark fits on a screen.

## Update steps

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "Roadmark design system"
git push
```

No `npm install`, no SQL. Hard-refresh with **Ctrl+Shift+R** after it deploys — the
stylesheet changed completely and a cached copy will look wrong.

## Worth a look

Open Roadmark and the TMS side by side. They should now read as one product family.
Anything that still feels off — spacing, a colour, the density — tell me which screen and
I'll adjust; the tokens live in one file so changes are quick.
