import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Live fleet map. trucks = [{ truck_id, unit_number, lat, lng, speed_mph,
    engine_state, address_text, located_at, driver_name }] */
export default function FleetMap({ trucks = [], height = 420, onSelect }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { scrollWheelZoom: true })
      .setView([39.5, -95], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const pts = trucks.filter((t) => typeof t.lat === 'number' && typeof t.lng === 'number');
    pts.forEach((t) => {
      const stale = t.located_at && (Date.now() - new Date(t.located_at)) > 24 * 3600 * 1000;
      const moving = Number(t.speed_mph) > 5;
      const color = stale ? '#8b93a1' : moving ? '#059669' : '#f5a300';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#171c26;font:600 11px/1 Barlow,sans-serif;
               padding:5px 7px;border-radius:6px;border:2px solid #fff;
               box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap">${t.unit_number ?? '?'}</div>`,
        iconSize: [1, 1], iconAnchor: [18, 12],
      });
      const m = L.marker([t.lat, t.lng], { icon }).addTo(layer);
      const when = t.located_at ? new Date(t.located_at).toLocaleString() : 'unknown';
      m.bindPopup(
        `<b>Truck ${t.unit_number ?? '—'}</b><br/>` +
        (t.driver_name ? `${t.driver_name}<br/>` : '') +
        (t.address_text ? `${t.address_text}<br/>` : '') +
        `${Number(t.speed_mph) || 0} mph · ${t.engine_state || 'engine unknown'}<br/>` +
        `<span style="color:#5b6472">${when}</span>`
      );
      if (onSelect) m.on('click', () => onSelect(t));
    });

    if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 8);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((t) => [t.lat, t.lng])).pad(0.25));
  }, [trucks, onSelect]);

  return (
    <div ref={elRef} style={{ height, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }} />
  );
}
