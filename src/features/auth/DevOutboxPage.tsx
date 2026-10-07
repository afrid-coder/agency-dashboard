import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AuthLayout } from './AuthLayout.tsx';
import { Button, EmptyState, Notice } from '../../components/ui.tsx';
import { relativeTime } from '../../lib/format.ts';

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  link: string | null;
  createdAt: string;
}

export function useDevOutbox() {
  const q = useQuery({ queryKey: ['config'], queryFn: () => fetch('/api/config').then((r) => r.json() as Promise<{ devOutbox: boolean }>), staleTime: Infinity });
  return q.data?.devOutbox ?? false;
}

/** Development only: shows email the server would have sent. */
export function DevOutboxPage() {
  const q = useQuery({
    queryKey: ['dev-outbox'],
    queryFn: async () => {
      const r = await fetch('/api/dev/outbox');
      if (!r.ok) throw new Error('unavailable');
      return (await r.json()) as Mail[];
    },
    refetchInterval: 3000,
    retry: false,
  });
  return (
    <AuthLayout eyebrow="Development only" title="Local inbox" subtitle="No email provider is configured, so messages are captured here instead of being sent. This page doesn’t exist in production.">
      {q.isError && <Notice tone="warning">The development inbox is turned off (an email provider is configured, or this is production).</Notice>}
      {q.data && q.data.length === 0 && <EmptyState icon="inbox" title="No messages yet">Sign up or request a password reset and the email will appear here.</EmptyState>}
      <ul className="outbox">
        {q.data?.map((m) => (
          <li key={m.id} className="outbox-item">
            <div className="outbox-meta">
              <span className="outbox-to">{m.to}</span>
              <span className="outbox-time">{relativeTime(m.createdAt)}</span>
            </div>
            <p className="outbox-subject">{m.subject}</p>
            {m.link && (
              <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => window.location.assign(m.link!.replace(/^https?:\/\/[^/]+/, ''))}>
                Open link
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="fine-print">
        <Link to="/signin">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
