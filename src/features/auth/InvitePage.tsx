import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout.tsx';
import { Button, Notice, Skeleton } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { authClient } from '../../lib/auth.ts';
import { keys } from '../../lib/queries.ts';
import { ROLE_LABEL, ROLE_SUMMARY } from '../../../shared/permissions.ts';
import type { InviteLookup, Me } from '../../../shared/types.ts';

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<InviteLookup>(`/invites/${token}`), retry: false });
  const me = useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/me'), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = encodeURIComponent(`/invite/${token}`);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/invites/${token}/accept`);
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate(me.data?.profile.onboarded ? '/app' : '/onboarding', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    await authClient.signOut();
    qc.clear();
    navigate(`/signin?next=${next}&email=${encodeURIComponent(invite.data?.email ?? '')}`);
  };

  if (invite.isPending)
    return (
      <AuthLayout title="Checking your invitation…">
        <Skeleton h={18} />
      </AuthLayout>
    );
  if (invite.isError)
    return (
      <AuthLayout title="Invitation not found" subtitle="This link isn’t valid. Check that you copied the whole link, or ask for a new invitation.">
        <Link to="/" className="btn btn-secondary btn-md">
          Go to the home page
        </Link>
      </AuthLayout>
    );

  const inv = invite.data;
  if (inv.status !== 'open')
    return (
      <AuthLayout
        title={inv.status === 'accepted' ? 'Invitation already used' : inv.status === 'expired' ? 'Invitation expired' : 'Invitation cancelled'}
        subtitle={inv.status === 'accepted' ? 'This invitation has already been accepted. Sign in to open the workspace.' : `Ask ${inv.invitedBy ?? 'an admin'} to send you a new invitation to ${inv.orgName}.`}
      >
        <Link to="/signin" className="btn btn-primary btn-md">
          Sign in
        </Link>
      </AuthLayout>
    );

  const signedIn = me.isSuccess;
  const matches = signedIn && me.data.user.email.toLowerCase() === inv.email;
  return (
    <AuthLayout eyebrow="Invitation" title={`Join ${inv.orgName}`} subtitle={`${inv.invitedBy ?? 'A teammate'} invited ${inv.email} to join as ${ROLE_LABEL[inv.role].toLowerCase() === 'admin' ? 'an admin' : 'a member'}.`}>
      <div className="invite-role">
        <span className="tag tag-violet">{ROLE_LABEL[inv.role]}</span>
        <p>{ROLE_SUMMARY[inv.role]}</p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {matches ? (
        <Button variant="primary" size="lg" onClick={accept} loading={busy}>
          Accept and open workspace
        </Button>
      ) : signedIn ? (
        <div className="form-grid">
          <Notice tone="warning">
            You’re signed in as {me.data.user.email}. This invitation is for {inv.email}.
          </Notice>
          <Button variant="primary" onClick={switchAccount}>
            Sign in as {inv.email}
          </Button>
        </div>
      ) : (
        <div className="form-grid">
          <Link to={`/signup?email=${encodeURIComponent(inv.email)}&next=${next}`} className="btn btn-primary btn-lg">
            Create account to accept
          </Link>
          <Link to={`/signin?email=${encodeURIComponent(inv.email)}&next=${next}`} className="btn btn-secondary btn-lg">
            I already have an account
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
