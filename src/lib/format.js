export const money = (n) =>
  (n === null || n === undefined) ? '—'
  : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const dt = (s) => s ? new Date(s).toLocaleString('en-US',
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export const d = (s) => s ? new Date(s).toLocaleDateString('en-US',
  { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const ago = (s) => {
  if (!s) return '—';
  const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

export const title = (s) => (s || '').replaceAll('_', ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());
