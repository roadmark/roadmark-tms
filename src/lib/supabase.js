import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Surface a clear message instead of a blank screen when env is missing
  document.body.innerHTML =
    '<div style="font-family:sans-serif;padding:40px;max-width:560px">' +
    '<h2>Missing configuration</h2><p>Create <code>.env.local</code> with ' +
    '<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> ' +
    '(see .env.example), then restart <code>npm run dev</code>.</p></div>';
  throw new Error('Missing Supabase env vars');
}

export const supabase = createClient(url, key);
