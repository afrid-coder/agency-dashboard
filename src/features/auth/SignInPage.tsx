import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout.tsx';
import { PasswordField } from './PasswordField.tsx';
import { Button, Field, Notice } from '../../components/ui.tsx';
import { authClient, authError, unreachable } from '../../lib/auth.ts';
import { keys } from '../../lib/queries.ts';
import { api } from '../../lib/api.ts';
import type { Me } from '../../../shared/types.ts';

export const safeNext = (next: string | null, fallback = '/app') => (next && next.startsWith('/') && !next.startsWith('//') ? next : fallback);

export function SignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password }).catch(unreachable);
    setBusy(false);
    if (err) return setError(authError(err));
    qc.clear();
    await qc.prefetchQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/me') }).catch(() => {});
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to the Lumera Creative workspace."
      footer={
        <p>
          New here? <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Create an account</Link>
        </p>
      }
    >
      {params.get('expired') && <Notice tone="info">Your session ended. Sign in again to continue where you left off.</Notice>}
      {params.get('reset') && <Notice tone="success">Your password was changed. Sign in with the new one.</Notice>}
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="auth-row">
          <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="link-sm">
            Forgot password?
          </Link>
        </div>
        {error && (
          <Notice tone="danger">
            <span>{error}</span>
          </Notice>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
