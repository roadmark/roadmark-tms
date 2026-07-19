import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// colours follow Roadmark's own map legend
export const PLACE_STYLE = {
  repair_shop:       { icon: '🔧', color: '#f2a93b', label: 'General repair' },
  mobile_repair:     { icon: '🚐', color: '#f2a93b', label: 'Mobile / roadside' },
  dealer:            { icon: '🏬', color: '#f2a93b', label: 'Dealer' },
  tire_shop:         { icon: '🛞', color: '#f2a93b', label: 'Tires' },
  towing:            { icon: '🪝', color: '#f2a93b', label: 'Towing' },
  parking:           { icon: '🅿', color: '#3b82f6', label: 'Parking' },
  truck_stop:        { icon: '⛽', color: '#ef4444', label: 'Truck stop' },
  weigh_station:     { icon: '⚖', color: '#a855f7', label: 'Weigh station' },
  cat_scale:         { icon: '⚖', color: '#eab308', label: 'CAT scale' },
  fuel:              { icon: '⛽', color: '#ef4444', label: 'Fuel' },
  yard:              { icon: '🏠', color: '#a78bfa', label: 'Our yard' },
  customer_facility: { icon: '🏭', color: '#60a5fa', label: 'Customer facility' },
  dropped_trailer:   { icon: '📦', color: '#f2a93b', label: 'Dropped trailer' },
  dropped_truck:     { icon: '🚚', color: '#f2a93b', label: 'Dropped truck' },
  hazard:            { icon: '⚠', color: '#f87171', label: 'Hazard' },
  other:             { icon: '📍', color: '#98a2ae', label: 'Other' },
};

/** Live fleet map: truck markers, place pins, and click-to-drop. */
const MAX_MARKERS = 700;   // Leaflet stays smooth well under this

/** Live weather radar — RainViewer is free and needs no key. */
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
/** HERE traffic flow raster tiles — uses the key you already have for routing. */
const HERE_TRAFFIC = (key) =>
  `https://traffic.maps.hereapi.com/v3/flow/mc/{z}/{x}/{y}/png8?apiKey=${key}&size=256&style=lite`;

export default function FleetMap({
  trucks = [], places = [], height = 520,
  onSelectTruck, onSelectPlace, dropMode = false, onDropPin, onVisibleChange,
  weather = false, traffic = false,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const truckLayer = useRef(null);
  const placeLayer = useRef(null);
  const [bounds, setBounds] = useState(null);
  const [radarPath, setRadarPath] = useState(null);
  const weatherLayer = useRef(null);
  const trafficLayer = useRef(null);
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

  // latest radar frame, refreshed every 5 minutes
  useEffect(() => {
    if (!weather) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(RAINVIEWER_INDEX);
        const j = await r.json();
        const frames = j?.radar?.past ?? [];
        const last = frames[frames.length - 1];
        if (alive && last?.path) setRadarPath(`${j.host || 'https://tilecache.rainviewer.com'}${last.path}`);
      } catch { /* radar is optional */ }
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [weather]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (weatherLayer.current) { map.removeLayer(weatherLayer.current); weatherLayer.current = null; }
    if (weather && radarPath) {
      weatherLayer.current = L.tileLayer(`${radarPath}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0.55, zIndex: 200, attribution: 'Radar &copy; RainViewer',
      }).addTo(map);
    }
  }, [weather, radarPath]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (trafficLayer.current) { map.removeLayer(trafficLayer.current); trafficLayer.current = null; }
    const key = import.meta.env.VITE_HERE_API_KEY;
    if (traffic && key) {
      trafficLayer.current = L.tileLayer(HERE_TRAFFIC(key), {
        opacity: 0.85, zIndex: 210, attribution: 'Traffic &copy; HERE',
      }).addTo(map);
    }
  }, [traffic]);

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
      const rec = p.is_recommended;
      const ring = p.company_id ? '#f2a93b' : rec ? '#fde68a' : 'rgba(255,255,255,.5)';
      const size = rec || p.company_id ? 26 : 22;
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${st.color};
               display:grid;place-items:center;font-size:${rec ? 13 : 11}px;
               border:2px solid ${ring};box-shadow:0 2px 6px rgba(0,0,0,.45)">${rec ? '★' : st.icon}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(layer);
      m.bindPopup(
        `<b>${p.name}</b><br/><span style="color:#8b95a5">${rec ? '★ Recommended · ' : ''}${
          p.brand ? p.brand + ' · ' : ''}${st.label}` +
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
