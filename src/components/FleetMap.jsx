import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const PLACE_STYLE = {
  repair_shop:       { icon: '🔧', color: '#f2a93b', label: 'Repair shop' },
  mobile_repair:     { icon: '🚐', color: '#f2a93b', label: 'Mobile repair' },
  dealer:            { icon: '🏬', color: '#60a5fa', label: 'Dealer' },
  tire_shop:         { icon: '🛞', color: '#a78bfa', label: 'Tire shop' },
  towing:            { icon: '🪝', color: '#f87171', label: 'Towing' },
  parking:           { icon: '🅿', color: '#34d399', label: 'Parking' },
  truck_stop:        { icon: '⛽', color: '#22d3ee', label: 'Truck stop' },
  weigh_station:     { icon: '⚖', color: '#98a2ae', label: 'Weigh station' },
  fuel:              { icon: '⛽', color: '#22d3ee', label: 'Fuel' },
  yard:              { icon: '🏠', color: '#a78bfa', label: 'Our yard' },
  customer_facility: { icon: '🏭', color: '#60a5fa', label: 'Customer facility' },
  dropped_trailer:   { icon: '📦', color: '#f2a93b', label: 'Dropped trailer' },
  dropped_truck:     { icon: '🚚', color: '#f2a93b', label: 'Dropped truck' },
  hazard:            { icon: '⚠', color: '#f87171', label: 'Hazard' },
  other:             { icon: '📍', color: '#98a2ae', label: 'Other' },
};

/** Live fleet map: truck markers, place pins, and click-to-drop. */
const MAX_MARKERS = 700;   // Leaflet stays smooth well under this

export default function FleetMap({
  trucks = [], places = [], height = 520,
  onSelectTruck, onSelectPlace, dropMode = false, onDropPin, onVisibleChange,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const truckLayer = useRef(null);
  const placeLayer = useRef(null);
  const [bounds, setBounds] = useState(null);
  const dropRef = useRef({ dropMode, onDropPin });
  dropRef.current = { dropMode, onDropPin };

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { scrollWheelZoom: true, zoomControl: true })
      .setView([39.5, -95], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    placeLayer.current = L.layerGroup().addTo(map);
    truckLayer.current = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      const { dropMode: dm, onDropPin: fn } = dropRef.current;
      if (dm && fn) fn({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    const sync = () => setBounds(map.getBounds());
    map.on('moveend zoomend', sync);
    sync();
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // cursor feedback while dropping a pin
  useEffect(() => {
    if (elRef.current) elRef.current.style.cursor = dropMode ? 'crosshair' : '';
  }, [dropMode]);

  // only draw the pins actually in view — a national directory is far too many at once
  const visible = useMemo(() => {
    const withCoords = places.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
    if (!bounds) return withCoords.slice(0, MAX_MARKERS);
    const inView = withCoords.filter((p) => bounds.contains([p.lat, p.lng]));
    // company pins always win a slot
    const ours = inView.filter((p) => p.company_id);
    const rest = inView.filter((p) => !p.company_id);
    return [...ours, ...rest].slice(0, MAX_MARKERS);
  }, [places, bounds]);

  useEffect(() => {
    if (!onVisibleChange || !bounds) return;
    const inView = places.filter((p) => typeof p.lat === 'number' && bounds.contains([p.lat, p.lng])).length;
    onVisibleChange({ shown: Math.min(inView, MAX_MARKERS), inView, total: places.length });
  }, [visible, bounds, places, onVisibleChange]);

  // places
  useEffect(() => {
    const layer = placeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    visible.forEach((p) => {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
      const st = PLACE_STYLE[p.kind] || PLACE_STYLE.other;
      const ring = p.company_id ? '#f2a93b' : 'rgba(255,255,255,.65)';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:50%;background:${st.color};
               display:grid;place-items:center;font-size:12px;border:2px solid ${ring};
               box-shadow:0 2px 6px rgba(0,0,0,.45)">${st.icon}</div>`,
        iconSize: [24, 24], iconAnchor: [12, 12],
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(layer);
      m.bindPopup(
        `<b>${p.name}</b><br/><span style="color:#8b95a5">${st.label}` +
        (p.preferred ? ' · preferred' : '') + (p.blacklisted ? ' · do not use' : '') + '</span>' +
        (p.address || p.city ? `<br/>${[p.address, p.city, p.state].filter(Boolean).join(', ')}` : '') +
        (p.phone ? `<br/>${p.phone}` : '') +
        (p.note ? `<br/><i>${p.note}</i>` : '')
      );
      if (onSelectPlace) m.on('click', () => onSelectPlace(p));
    });
  }, [visible, onSelectPlace]);

  // trucks
  useEffect(() => {
    const map = mapRef.current, layer = truckLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = trucks.filter((t) => typeof t.lat === 'number' && typeof t.lng === 'number');
    pts.forEach((t) => {
      const stale = t.located_at && (Date.now() - new Date(t.located_at)) > 24 * 3600 * 1000;
      const moving = Number(t.speed_mph) > 5;
      const color = stale ? '#8b95a5' : moving ? '#34d399' : '#f2a93b';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#0d0f13;font:700 11px/1 Archivo,sans-serif;
               padding:5px 7px;border-radius:6px;border:2px solid #fff;
               box-shadow:0 2px 8px rgba(0,0,0,.5);white-space:nowrap">${t.unit_number ?? '?'}</div>`,
        iconSize: [1, 1], iconAnchor: [18, 12],
      });
      const m = L.marker([t.lat, t.lng], { icon, zIndexOffset: 500 }).addTo(layer);
      const when = t.located_at ? new Date(t.located_at).toLocaleString() : 'unknown';
      m.bindPopup(
        `<b>Truck ${t.unit_number ?? '—'}</b><br/>` +
        (t.driver_name ? `${t.driver_name}<br/>` : '') +
        (t.address_text ? `${t.address_text}<br/>` : '') +
        `${Number(t.speed_mph) || 0} mph · ${t.engine_state || 'engine unknown'}<br/>` +
        `<span style="color:#8b95a5">${when}</span>`
      );
      if (onSelectTruck) m.on('click', () => onSelectTruck(t));
    });
    if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 8);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((t) => [t.lat, t.lng])).pad(0.25));
  }, [trucks, onSelectTruck]);

  return (
    <div ref={elRef} style={{ height, width: '100%', borderRadius: 12,
      overflow: 'hidden', border: '1px solid var(--line)' }} />
  );
}
