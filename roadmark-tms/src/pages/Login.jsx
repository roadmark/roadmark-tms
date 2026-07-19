import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorNote } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error);
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Roadmark TMS</h1>
        <div className="sub">Carrier operations. Sign in with your company account.</div>
        <div className="roadline" />
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            autoComplete="email" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
            autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
          disabled={busy || !email || !password} onClick={submit}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted" style={{ marginTop: 14 }}>
          Accounts are invite-only. Ask your master admin for access.
        </p>
      </div>
    </div>
  );
}
