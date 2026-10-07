import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from './AuthLayout.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { authClient, authError } from '../../lib/auth.ts';
import { useDevOutbox } from './DevOutboxPage.tsx';

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(params.get('resent') ? 'sent' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const devOutbox = useDevOutbox();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (!email) return;
    setStatus('sending');
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: '/onboarding' });
    if (error) {
      setStatus('error');
      setMessage(authError(error));
    } else {
      setStatus('sent');
      setCooldown(60);
    }
  };

  return (
    <AuthLayout
      eyebrow="One more step"
      title="Check your inbox"
      subtitle={
        email ? (
          <>
            We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish setting up your account. The link works for 24 hours.
          </>
        ) : (
          'We sent a confirmation link to your email address. Open it to finish setting up your account.'
        )
      }
      footer={
        <p>
          Wrong address? <Link to="/signup">Start again</Link> · <Link to="/signin">Sign in</Link>
        </p>
      }
    >
      <div className="check-email">
        <span className="check-email-icon">
          <Icon name="mailOpen" size={26} />
        </span>
        {status === 'sent' && <Notice tone="success">A fresh confirmation link is on its way.</Notice>}
        {status === 'error' && message && <Notice tone="danger">{message}</Notice>}
        {email && (
          <Button variant="secondary" icon="refresh" onClick={resend} loading={status === 'sending'} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend confirmation email'}
          </Button>
        )}
        <p className="fine-print">Can’t find it? Check spam or promotions, and make sure the address above is correct.</p>
        {devOutbox && (
          <Notice tone="violet" icon="inbox">
            Development mode: no email provider is configured, so messages are captured locally. <Link to="/dev/outbox">Open the development inbox</Link>.
          </Notice>
        )}
      </div>
    </AuthLayout>
  );
}
