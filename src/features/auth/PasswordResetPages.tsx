import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from './AuthLayout.tsx';
import { PasswordField } from './PasswordField.tsx';
import { Button, Field, Notice } from '../../components/ui.tsx';
import { authClient, authError } from '../../lib/auth.ts';
import { emailSchema, passwordProblem } from '../../../shared/schemas.ts';
import { useDevOutbox } from './DevOutboxPage.tsx';

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const devOutbox = useDevOutbox();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError(null);
    setBusy(true);
    const { error: err } = await authClient.requestPasswordReset({ email: parsed.data, redirectTo: '/reset-password' });
    setBusy(false);
    if (err && err.status === 429) return setError(authError(err));
    // Same message whether or not an account exists, so addresses can't be probed.
    setSent(true);
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you sign in with. If it matches an account, we’ll send a link to choose a new password."
      footer={
        <p>
          Remembered it? <Link to="/signin">Sign in</Link>
        </p>
      }
    >
      {sent ? (
        <div className="form-grid">
          <Notice tone="success">If an account exists for {email}, a reset link is on its way. It works for one hour.</Notice>
          {devOutbox && (
            <Notice tone="violet" icon="inbox">
              Development mode: <Link to="/dev/outbox">open the development inbox</Link> to find the link.
            </Notice>
          )}
          <Button variant="secondary" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="email" error={error ?? undefined}>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const invalid = params.get('error') === 'INVALID_TOKEN' || !token;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const p = passwordProblem(password);
    if (p) errs.password = p;
    if (password !== confirm) errs.confirm = 'The passwords don’t match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setBusy(false);
    if (error) return setFormError(authError(error));
    navigate('/signin?reset=1', { replace: true });
  };

  if (invalid)
    return (
      <AuthLayout title="This link has expired" subtitle="Password reset links work once, for one hour.">
        <Link to="/forgot-password" className="btn btn-primary btn-lg">
          Request a new link
        </Link>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Choose a new password" subtitle="You’ll be signed out everywhere else once it’s saved.">
      <form className="form-grid" onSubmit={submit} noValidate>
        <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" showRules error={errors.password} autoFocus />
        <PasswordField id="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} />
        {formError && <Notice tone="danger">{formError}</Notice>}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Save password
        </Button>
      </form>
    </AuthLayout>
  );
}
