import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/AuthProvider';
import { Drawer, Field, ErrorNote } from '../../components/ui';
import { parseCsv, guessMapping, toDate, toNum, FUEL_FIELDS, TOLL_FIELDS } from '../../lib/csv';
import { money } from '../../lib/format';

/** Import wizard for fuel and toll provider statements.
    kind = 'fuel' | 'toll' */
export default function ImportWizard({ kind, onClose, onDone }) {
  const { companyId, user } = useAuth();
  const qc = useQueryClient();
  const FIELDS = kind === 'fuel' ? FUEL_FIELDS : TOLL_FIELDS;
  const mapKey = `rtms.map.${kind}.${companyId}`;

  const [phase, setPhase] = useState('pick');   // pick -> map -> importing -> done
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [lookups, setLookups] = useState(null);
  const [result, setResult] = useState(null);

  // reference data used to suggest driver + unit
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const [trucks, cards, assigns, drivers] = await Promise.all([
        supabase.from('trucks').select('id, unit_number, plate, toll_device_code').eq('company_id', companyId),
        supabase.from('fuel_cards').select('card_number, driver_id, truck_id').eq('company_id', companyId),
        supabase.from('assignments').select('driver_id, truck_id').eq('company_id', companyId).is('ended_at', null),
        supabase.from('drivers').select('id, full_name').eq('company_id', companyId),
      ]);
      setLookups({
        trucks: trucks.data || [], cards: cards.data || [],
        assigns: assigns.data || [], drivers: drivers.data || [],
      });
    })();
  }, [companyId]);

  const pickFile = async (f) => {
    try {
      setError(null); setFile(f);
      const { headers: h, rows: r } = await parseCsv(f);
      if (!h.length) throw new Error('No columns found — is this a CSV file?');
      setHeaders(h); setRows(r);
      const saved = (() => { try { return JSON.parse(localStorage.getItem(mapKey) || 'null'); } catch { return null; } })();
      const savedValid = saved && Object.values(saved).every((v) => !v || h.includes(v));
      setMapping(savedValid ? saved : guessMapping(h, FIELDS));
      setPhase('map');
    } catch (e) { setError(e); }
  };

  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);

  const prepared = useMemo(() => {
    if (phase !== 'map' || !lookups) return null;
    const get = (row, key) => (mapping[key] ? row[mapping[key]] : '');
    const byUnit = new Map(lookups.trucks.map((t) => [String(t.unit_number).toLowerCase(), t]));
    const byPlate = new Map(lookups.trucks.filter((t) => t.plate).map((t) => [String(t.plate).toLowerCase().replace(/\s/g, ''), t]));
    const byTag = new Map(lookups.trucks.filter((t) => t.toll_device_code).map((t) => [String(t.toll_device_code).toLowerCase(), t]));
    const byCard = new Map(lookups.cards.map((c) => [String(c.card_number).replace(/\D/g, '').slice(-6), c]));
    const driverOfTruck = new Map(lookups.assigns.filter((a) => a.truck_id).map((a) => [a.truck_id, a.driver_id]));
    const byDriverName = new Map(lookups.drivers.map((d) => [d.full_name.toLowerCase(), d.id]));

    const out = [];
    const problems = [];
    rows.forEach((row, i) => {
      const date = toDate(get(row, 'issued_date'));
      const total = toNum(get(row, kind === 'fuel' ? 'total' : 'amount'));
      if (!date) { problems.push(`Row ${i + 2}: unreadable date`); return; }

      let truck = null, driverId = null;
      const unit = String(get(row, 'unit_number') || '').trim().toLowerCase();
      if (unit && byUnit.has(unit)) truck = byUnit.get(unit);
      if (!truck && kind === 'toll') {
        const tag = String(get(row, 'tag_number') || '').trim().toLowerCase();
        const plate = String(get(row, 'license_plate') || '').trim().toLowerCase().replace(/\s/g, '');
        if (tag && byTag.has(tag)) truck = byTag.get(tag);
        else if (plate && byPlate.has(plate)) truck = byPlate.get(plate);
      }
      if (kind === 'fuel') {
        const card = String(get(row, 'card_number') || '').replace(/\D/g, '').slice(-6);
        const hit = card && byCard.get(card);
        if (hit) { driverId = hit.driver_id || null; if (!truck && hit.truck_id) truck = lookups.trucks.find((t) => t.id === hit.truck_id) || null; }
        const dname = String(get(row, 'driver_name') || '').trim().toLowerCase();
        if (!driverId && dname && byDriverName.has(dname)) driverId = byDriverName.get(dname);
      }
      if (!driverId && truck) driverId = driverOfTruck.get(truck.id) || null;

      const base = {
        company_id: companyId,
        transaction_id: String(get(row, 'transaction_id') || '').trim() || null,
        issued_date: date,
        suggested_truck_id: truck?.id || null,
        suggested_driver_id: driverId || null,
        driver_id: driverId || null,
        truck_id: truck?.id || null,
        charge_to: 'driver',
        status: 'open',
        created_by: user?.id || null,
      };

      if (kind === 'fuel') {
        const amount = toNum(get(row, 'amount')) || total;
        out.push({
          ...base,
          card_number: String(get(row, 'card_number') || '').trim() || null,
          location: String(get(row, 'location') || '').trim() || null,
          city: String(get(row, 'city') || '').trim() || null,
          state: String(get(row, 'state') || '').trim().slice(0, 2) || null,
          product: String(get(row, 'product') || 'ULSD').trim() || 'ULSD',
          quantity: toNum(get(row, 'quantity')) || null,
          amount, fee: toNum(get(row, 'fee')), total,
          discount: toNum(get(row, 'discount')),
        });
      } else {
        out.push({
          ...base,
          tag_number: String(get(row, 'tag_number') || '').trim() || null,
          license_plate: String(get(row, 'license_plate') || '').trim() || null,
          plaza_name: String(get(row, 'plaza_name') || '').trim() || null,
          amount: total,
        });
      }
    });
    const matched = out.filter((r) => r.driver_id).length;
    return { out, problems, matched };
  }, [phase, rows, mapping, lookups, kind, companyId, user]);

  const runImport = async () => {
    try {
      setPhase('importing'); setError(null);
      localStorage.setItem(mapKey, JSON.stringify(mapping));
      const table = kind === 'fuel' ? 'fuel_transactions' : 'toll_transactions';
      let toInsert = prepared.out;

      // duplicate protection: skip transaction ids already stored for the same dates
      const ids = [...new Set(toInsert.map((r) => r.transaction_id).filter(Boolean))];
      let skipped = 0;
      if (ids.length) {
        const existing = new Set();
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await supabase.from(table)
            .select('transaction_id, issued_date')
            .eq('company_id', companyId).in('transaction_id', ids.slice(i, i + 300));
          (data || []).forEach((r) => existing.add(`${r.transaction_id}|${r.issued_date}`));
        }
        const before = toInsert.length;
        toInsert = toInsert.filter((r) => !r.transaction_id || !existing.has(`${r.transaction_id}|${r.issued_date}`));
        skipped = before - toInsert.length;
      }

      const { data: batch } = await supabase.from('import_batches').insert({
        company_id: companyId, kind, file_name: file?.name || null,
        total_rows: rows.length, imported_rows: 0, skipped_rows: skipped,
        errors: prepared.problems.length ? prepared.problems.slice(0, 50) : null,
        created_by: user?.id || null,
      }).select('id').single();

      let imported = 0;
      for (let i = 0; i < toInsert.length; i += 300) {
        const chunk = toInsert.slice(i, i + 300).map((r) => ({ ...r, import_batch_id: batch?.id || null }));
        const { error: insErr } = await supabase.from(table).insert(chunk);
        if (insErr) throw insErr;
        imported += chunk.length;
      }
      if (batch?.id) await supabase.from('import_batches').update({ imported_rows: imported }).eq('id', batch.id);

      setResult({ imported, skipped, problems: prepared.problems.length, matched: prepared.matched });
      setPhase('done');
      qc.invalidateQueries();
    } catch (e) { setError(e); setPhase('map'); }
  };

  const title = kind === 'fuel' ? 'Import fuel statement' : 'Import toll statement';

  return (
    <Drawer title={title} onClose={onClose}
      footer={
        phase === 'map' ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!!missingRequired.length || !prepared?.out.length}
              onClick={runImport}>
              Import {prepared?.out.length || 0} rows
            </button>
          </>
        ) : <button className="btn btn-ghost" onClick={onClose}>Close</button>
      }>
      <ErrorNote error={error} />

      {phase === 'pick' && (
        <>
          <p className="muted">Export the statement from your provider as CSV
            {kind === 'fuel' ? ' (EFS, Comdata, WEX…)' : ' (Bestpass, EZPass, PrePass…)'} and drop it here.
            Your column names don't have to match ours — you'll map them on the next screen,
            and the mapping is remembered for next time.</p>
          <input type="file" accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <p className="small muted" style={{ marginTop: 10 }}>
            Rows already imported (same transaction ID and date) are skipped automatically.
          </p>
        </>
      )}

      {phase === 'map' && (
        <>
          <p className="small muted">{file?.name} — {rows.length} rows, {headers.length} columns.
            Match your columns to the fields below.</p>
          {missingRequired.length > 0 && (
            <div className="error-note">Required: {missingRequired.join(', ')}</div>
          )}
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
              <select value={mapping[f.key] || ''}
                onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                <option value="">— not in file —</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
          ))}

          {prepared && (
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', marginTop: 8 }}>
              <div className="small"><b>Preview</b></div>
              <div className="small">Ready to import: <b>{prepared.out.length}</b> rows</div>
              <div className="small">Driver matched automatically: <b>{prepared.matched}</b> of {prepared.out.length}</div>
              {prepared.problems.length > 0 && (
                <div className="small" style={{ color: 'var(--danger)' }}>
                  Skipped (bad date): {prepared.problems.length} — {prepared.problems[0]}
                </div>
              )}
              {prepared.out[0] && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  First row: {prepared.out[0].issued_date} ·{' '}
                  {money(kind === 'fuel' ? prepared.out[0].total : prepared.out[0].amount)}
                  {prepared.out[0].driver_id ? ' · driver matched' : ' · no driver match'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {phase === 'importing' && <p>Importing… don't close this window.</p>}

      {phase === 'done' && result && (
        <>
          <h3 style={{ fontFamily: 'var(--font-display)' }}>Import finished</h3>
          <ul className="small">
            <li><b>{result.imported}</b> rows imported</li>
            <li><b>{result.matched}</b> matched to a driver automatically</li>
            {result.skipped > 0 && <li><b>{result.skipped}</b> skipped as already imported</li>}
            {result.problems > 0 && <li><b>{result.problems}</b> rows skipped (unreadable date)</li>}
          </ul>
          <p className="small muted">Unmatched rows show a “—” in the driver column on the
            {kind === 'fuel' ? ' Fuel' : ' Tolls'} tab — set the driver there and the charge
            joins their next settlement.</p>
          <button className="btn btn-primary" onClick={() => { onDone?.(); onClose(); }}>Show the rows</button>
        </>
      )}
    </Drawer>
  );
}
