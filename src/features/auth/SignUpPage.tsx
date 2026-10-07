import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout.tsx';
import { PasswordField } from './PasswordField.tsx';
import { safeNext } from './SignInPage.tsx';
import { Button, Field, Notice, Switch, describedBy } from '../../components/ui.tsx';
import { PinInput } from '../../components/PinInput.tsx';
import { authClient, authError } from '../../lib/auth.ts';
import { detectTimeZone } from '../../lib/format.ts';
import { adminCodeSchema, emailSchema, nameSchema, passwordProblem } from '../../../shared/schemas.ts';

export function SignUpPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invited = Boolean(params.get('email'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const n = nameSchema.safeParse(name);
    if (!n.success) errs.name = n.error.issues[0].message;
    const em = emailSchema.safeParse(email);
    if (!em.success) errs.email = em.error.issues[0].message;
    const pw = passwordProblem(password, { email });
    if (pw) errs.password = pw;
    if (admin && !adminCodeSchema.safeParse(adminCode).success) errs.adminCode = 'Enter the four-digit admin code.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const extra = { timezone: detectTimeZone(), ...(admin ? { admin: true, adminCode } : {}) };
    const { error } = await authClient.signUp.email({ name: n.data!, email: em.data!, password, ...extra } as Parameters<typeof authClient.signUp.email>[0]);
    setBusy(false);
    if (error) {
      if (error.code === 'BAD_ADMIN_CODE') {
        setAdminCode('');
        return setErrors({ adminCode: authError(error) });
      }
      return setFormError(authError(error));
    }
    // Signed in straight away. Admins land in the workspace; everyone else on the access screen.
    qc.clear();
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle={invited ? 'Create your account, then accept the invitation.' : 'You’ll be signed in as soon as your account is created.'}
      footer={
        <p>
          Already have an account? <Link to={`/signin${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Sign in</Link>
        </p>
      }
    >
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label="Your name" htmlFor="name" error={errors.name} hint="Shown next to everything you add, so your teammates know it was you.">
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={describedBy('name', errors.name, 'x')} maxLength={80} autoFocus />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email} hint={invited ? 'Use the address your invitation was sent to.' : undefined}>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email) || undefined} aria-describedby={describedBy('email', errors.email, invited ? 'x' : undefined)} />
        </Field>
        <PasswordField id="password" value={password} onChange={setPassword} autoComplete="new-password" showRules email={email} error={errors.password} />
        {!invited && (
          <div className="admin-signup">
            <Switch
              id="admin"
              checked={admin}
              onChange={(v) => {
                setAdmin(v);
                setErrors(({ adminCode: _drop, ...rest }) => rest);
              }}
              label="Admin"
              description="For the business owners. Needs the four-digit admin code."
            />
            {admin && (
              <Field label="Admin code" htmlFor="admin-code" error={errors.adminCode}>
                <PinInput id="admin-code" label="Admin code" value={adminCode} onChange={setAdminCode} autoComplete="off" invalid={Boolean(errors.adminCode)} describedBy={errors.adminCode ? 'admin-code-error' : undefined} autoFocus />
              </Field>
            )}
          </div>
        )}
        {formError && <Notice tone="danger">{formError}</Notice>}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {admin ? 'Create admin account' : 'Create account'}
        </Button>
        {!invited && !admin && <p className="fine-print">Without the admin code, you’ll get access once an owner or admin invites your email.</p>}
      </form>
    </AuthLayout>
  );
}
