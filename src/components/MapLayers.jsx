import { useMemo, useState } from 'react';
import { PLACE_STYLE } from './FleetMap';

/** Roadmark-style layer tree: Recommended · Truck stops (by brand) · Parking · … */
export default function MapLayers({ places, filter, setFilter, truckCount, ourCount }) {
  const [openBrands, setOpenBrands] = useState(false);

  const tree = useMemo(() => {
    const directory = places.filter((p) => !p.company_id);
    const recommended = directory.filter((p) => p.is_recommended);
    const stops = directory.filter((p) => p.kind === 'truck_stop');
    const brandMap = {};
    stops.forEach((p) => {
      const b = p.brand?.trim() || 'Other truck stops';
      brandMap[b] = (brandMap[b] || 0) + 1;
    });
    const others = {};
    directory.filter((p) => !p.is_recommended && p.kind !== 'truck_stop')
      .forEach((p) => { others[p.kind] = (others[p.kind] || 0) + 1; });
    return {
      recommended: recommended.length,
      stops: stops.length,
      brands: Object.entries(brandMap).sort((a, b) => b[1] - a[1]),
      others: Object.entries(others).sort((a, b) => b[1] - a[1]),
    };
  }, [places]);

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));

  const toggleBrand = (b) => {
    setFilter((f) => {
      const all = new Set(tree.brands.map(([x]) => x));
      const next = new Set(f.brands ?? all);
      if (next.has(b)) next.delete(b); else next.add(b);
      return { ...f, brands: next.size === all.size ? null : next, stops: next.size > 0 };
    });
  };

  const toggleKind = (k) => {
    setFilter((f) => {
      const next = new Set(f.kinds ?? tree.others.map(([x]) => x));
      if (next.has(k)) next.delete(k); else next.add(k);
      return { ...f, kinds: next };
    });
  };

  const kindOn = (k) => !filter.kinds || filter.kinds.has(k);
  const brandOn = (b) => !filter.brands || filter.brands.has(b);

  const allOn = filter.trucks && filter.ours && filter.recommended && filter.stops
    && !filter.brands && (!filter.kinds || filter.kinds.size === tree.others.length);

  return (
    <div className="layer-panel">
      <label className="layer-row head">
        <input type="checkbox" checked={allOn} onChange={(e) => setFilter({
          trucks: e.target.checked, ours: e.target.checked, recommended: e.target.checked,
          stops: e.target.checked, brands: null,
          kinds: e.target.checked ? null : new Set(),
          preferredOnly: false,
        })} />
        <b>Select all</b>
      </label>

      <label className="layer-row" style={{ background: 'var(--accent-soft)' }}>
        <input type="checkbox" checked={filter.recommended}
          onChange={(e) => set({ recommended: e.target.checked })} />
        <span className="swatch" style={{ background: '#f2a93b' }} />
        <span style={{ flex: 1 }}>★ Recommended</span>
        <b className="num">{tree.recommended.toLocaleString()}</b>
      </label>

      <div className="layer-row">
        <input type="checkbox" checked={filter.stops}
          onChange={(e) => set({ stops: e.target.checked, brands: null })} />
        <span className="swatch" style={{ background: '#ef4444' }} />
        <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpenBrands((v) => !v)}>
          Truck stops {openBrands ? '▾' : '▸'}
        </span>
        <b className="num">{tree.stops.toLocaleString()}</b>
      </div>
      {openBrands && tree.brands.map(([b, n]) => (
        <label className="layer-row sub" key={b}>
          <input type="checkbox" checked={brandOn(b)} onChange={() => toggleBrand(b)} />
          <span className="swatch small" style={{ background: '#ef4444' }} />
          <span style={{ flex: 1 }}>{b}</span>
          <b className="num">{n.toLocaleString()}</b>
        </label>
      ))}

      {tree.others.map(([k, n]) => {
        const st = PLACE_STYLE[k] || PLACE_STYLE.other;
        return (
          <label className="layer-row" key={k}>
            <input type="checkbox" checked={kindOn(k)} onChange={() => toggleKind(k)} />
            <span className="swatch" style={{ background: st.color }} />
            <span style={{ flex: 1 }}>{st.label}</span>
            <b className="num">{n.toLocaleString()}</b>
          </label>
        );
      })}

      <div className="layer-divider" />

      <label className="layer-row">
        <input type="checkbox" checked={filter.ours} onChange={(e) => set({ ours: e.target.checked })} />
        <span className="swatch" style={{ background: '#f2a93b' }} />
        <span style={{ flex: 1 }}>Our pins</span>
        <b className="num">{ourCount}</b>
      </label>
      <label className="layer-row">
        <input type="checkbox" checked={filter.trucks} onChange={(e) => set({ trucks: e.target.checked })} />
        <span className="swatch" style={{ background: '#34d399' }} />
        <span style={{ flex: 1 }}>Our trucks</span>
        <b className="num">{truckCount}</b>
      </label>
      <label className="layer-row">
        <input type="checkbox" checked={filter.preferredOnly}
          onChange={(e) => set({ preferredOnly: e.target.checked })} />
        <span className="swatch" style={{ background: '#34d399' }} />
        <span style={{ flex: 1 }}>Preferred only</span>
      </label>
    </div>
  );
}
