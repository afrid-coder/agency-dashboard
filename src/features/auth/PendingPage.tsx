import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout.tsx';
import { Button, Field, Notice } from '../../components/ui.tsx';
import { PinInput } from '../../components/PinInput.tsx';
import { Icon } from '../../lib/icons.tsx';
import { ApiRequestError, api, errorMessage } from '../../lib/api.ts';
import { authClient } from '../../lib/auth.ts';
import { keys } from '../../lib/queries.ts';
import { detectTimeZone } from '../../lib/format.ts';
import { ROLE_LABEL } from '../../../shared/permissions.ts';
import type { Me } from '../../../shared/types.ts';

/** Signed in, but not yet a member of any workspace. */
export function PendingPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  if (!me.profile.onboarded) return <Navigate to="/onboarding" replace />;
  if (me.workspace) return <Navigate to="/app" replace />;

  const refresh = async () => {
    setBusy('refresh');
    await qc.invalidateQueries({ queryKey: keys.me });
    setBusy(null);
  };

  const accept = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/me/invitations/${id}/accept`);
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const joinAsAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) return setCodeError('Enter the four-digit admin code.');
    setBusy('admin');
    setCodeError(null);
    try {
      await api.post('/me/admin-access', { code, timezone: me.profile.timezone !== 'UTC' ? me.profile.timezone : detectTimeZone() });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate('/app', { replace: true });
    } catch (err) {
      setCode('');
      setCodeError(err instanceof ApiRequestError && err.fields?.adminCode ? err.fields.adminCode : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate('/');
  };

  const invites = me.pendingInvitations;
  return (
    <AuthLayout
      eyebrow="Access pending"
      title={invites.length ? 'You’ve been invited' : 'Your account is ready'}
      subtitle={
        invites.length ? (
          'Accept an invitation to open the workspace.'
        ) : (
          <>
            You’re signed in as <strong>{me.user.email}</strong>. Company data stays private until you join the workspace.
          </>
        )
      }
      footer={
        <p>
          Not you?{' '}
          <button type="button" className="link-btn" onClick={signOut}>
            Sign out
          </button>
        </p>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {me.adminCodeAvailable && (
        <form className="setup-box" onSubmit={joinAsAdmin} noValidate>
          <p className="form-section-title">One of the business owners?</p>
          <p className="field-hint">Enter the admin code to join Lumera Creative as an admin. You’ll see everything your partner has added.</p>
          <Field label="Admin code" htmlFor="admin-code" error={codeError ?? undefined}>
            <PinInput id="admin-code" label="Admin code" value={code} onChange={setCode} autoComplete="off" invalid={Boolean(codeError)} describedBy={codeError ? 'admin-code-error' : undefined} />
          </Field>
          <Button type="submit" variant="primary" loading={busy === 'admin'} disabled={code.length !== 4}>
            Join as admin
          </Button>
        </form>
      )}
      {invites.length > 0 ? (
        <ul className="pending-invites">
          {invites.map((i) => (
            <li key={i.id}>
              <div>
                <p className="pending-org">{i.orgName}</p>
                <p className="pending-sub">
                  {ROLE_LABEL[i.role]} · invited by {i.invitedBy ?? 'an admin'}
                </p>
              </div>
              <Button variant="primary" onClick={() => void accept(i.id)} loading={busy === i.id}>
                Accept
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pending-wait">
          <p className="form-section-title">Joining as a team member?</p>
          <ol className="pending-steps">
            <li>
              <Icon name="mail" size={17} />
              <span>
                Ask an owner or admin to invite <strong>{me.user.email}</strong> from Settings → Members.
              </span>
            </li>
            <li>
              <Icon name="link" size={17} />
              <span>Open the link in the invitation email to join.</span>
            </li>
          </ol>
          <Button variant="secondary" icon="refresh" onClick={refresh} loading={busy === 'refresh'}>
            Check again
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
