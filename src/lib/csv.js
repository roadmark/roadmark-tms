import Papa from 'papaparse';

/** Parse a CSV file in the browser. Returns { headers, rows } (rows = array of objects). */
export function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => (h || '').trim(),
      complete: (res) => {
        const headers = (res.meta.fields || []).filter(Boolean);
        resolve({ headers, rows: res.data.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== '')) });
      },
      error: reject,
    });
  });
}

/** Export any array of objects as a CSV download. */
export function downloadCsv(filename, rows) {
  const csv = Papa.unparse(rows || []);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guess which CSV header feeds each target field, using synonym lists. */
export function guessMapping(headers, fields) {
  const out = {};
  const used = new Set();
  for (const f of fields) {
    const cands = [f.key, ...(f.synonyms || [])].map(norm);
    let hit = headers.find((h) => !used.has(h) && cands.includes(norm(h)));
    if (!hit) hit = headers.find((h) => !used.has(h) && cands.some((c) => norm(h).includes(c) && c.length > 3));
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  return out;
}

/** Tolerant date parser: MM/DD/YYYY, YYYY-MM-DD, DD.MM.YYYY, with optional time. */
export function toDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/** Money/number parser: strips $, commas, spaces; handles (1.23) negatives. */
export function toNum(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[()$,\s]/g, '').replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

export const FUEL_FIELDS = [
  { key: 'transaction_id', label: 'Transaction ID', synonyms: ['transaction', 'trans id', 'invoice', 'ref', 'transactionnumber'], required: false },
  { key: 'issued_date', label: 'Date', synonyms: ['transaction date', 'trans date', 'date time', 'posting date', 'purchasedate'], required: true },
  { key: 'card_number', label: 'Card number', synonyms: ['card', 'card #', 'cardnumber', 'account'], required: false },
  { key: 'unit_number', label: 'Unit / truck #', synonyms: ['unit', 'truck', 'vehicle', 'unitnumber', 'assetid'], required: false },
  { key: 'driver_name', label: 'Driver name', synonyms: ['driver', 'drivername', 'employee'], required: false },
  { key: 'location', label: 'Location / merchant', synonyms: ['merchant', 'site', 'truckstop', 'name', 'stopname'], required: false },
  { key: 'city', label: 'City', synonyms: ['city'], required: false },
  { key: 'state', label: 'State', synonyms: ['state', 'st', 'province'], required: false },
  { key: 'product', label: 'Product', synonyms: ['fuel type', 'item', 'category', 'productname'], required: false },
  { key: 'quantity', label: 'Quantity (gal)', synonyms: ['qty', 'gallons', 'gal', 'units', 'volume'], required: false },
  { key: 'amount', label: 'Amount', synonyms: ['net', 'net amount', 'subtotal', 'fuelamount'], required: false },
  { key: 'fee', label: 'Fee', synonyms: ['fees', 'transaction fee', 'surcharge'], required: false },
  { key: 'total', label: 'Total', synonyms: ['total amount', 'grand total', 'amt', 'charge'], required: true },
  { key: 'discount', label: 'Discount', synonyms: ['disc', 'savings', 'discountamount'], required: false },
];

export const TOLL_FIELDS = [
  { key: 'transaction_id', label: 'Transaction ID', synonyms: ['transaction', 'trans id', 'id', 'transactionnumber'], required: false },
  { key: 'issued_date', label: 'Date', synonyms: ['transaction date', 'posting date', 'date time', 'exitdate'], required: true },
  { key: 'tag_number', label: 'Tag number', synonyms: ['tag', 'transponder', 'device', 'tagid'], required: false },
  { key: 'license_plate', label: 'License plate', synonyms: ['plate', 'lp', 'licenseplate', 'vehicleplate'], required: false },
  { key: 'unit_number', label: 'Unit / truck #', synonyms: ['unit', 'truck', 'vehicle'], required: false },
  { key: 'plaza_name', label: 'Plaza / exit', synonyms: ['plaza', 'exit', 'location', 'facility', 'agency'], required: false },
  { key: 'amount', label: 'Amount', synonyms: ['toll', 'total', 'charge', 'tollamount'], required: true },
];
