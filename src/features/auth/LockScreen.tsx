import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { PinInput } from '../../components/PinInput.tsx';
import { Avatar, Button, Notice } from '../../components/ui.tsx';
import { LumeraLogo } from '../../components/LumeraLogo.tsx';
import { api, ApiRequestError } from '../../lib/api.ts';
import { authClient } from '../../lib/auth.ts';
import type { Me } from '../../../shared/types.ts';

/** Quick unlock with the optional PIN. The PIN never signs anyone in on its own. */
export function LockScreen({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Locked · Lumera Creative';
  }, []);

  const unlock = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/session/unlock', { pin: value });
      await qc.invalidateQueries();
    } catch (err) {
      setPin('');
      if (err instanceof ApiRequestError && err.status === 401) {
        qc.clear();
        navigate('/signin?expired=1', { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pin.length === 4) void unlock(pin);
  };

  const usePassword = async () => {
    await authClient.signOut();
    qc.clear();
    navigate(`/signin?email=${encodeURIComponent(me.user.email)}`, { replace: true });
  };

  return (
    <main className="lock" id="main">
      <form className="lock-card" onSubmit={submit}>
        <LumeraLogo size={44} />
        <Avatar member={{ id: me.user.id, name: me.user.name, avatarUrl: me.user.avatarUrl }} size={56} />
        <h1 className="lock-title">Workspace locked</h1>
        <p className="lock-sub">Enter your PIN to continue as {me.user.name.split(' ')[0]}.</p>
        <PinInput
          id="unlock-pin"
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (v.length === 4 && !busy) void unlock(v);
          }}
          invalid={Boolean(error)}
          describedBy={error ? 'unlock-error' : undefined}
          autoFocus
        />
        {error && (
          <Notice tone="danger">
            <span id="unlock-error">{error}</span>
          </Notice>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={pin.length !== 4}>
          Unlock
        </Button>
        <button type="button" className="link-btn" onClick={usePassword}>
          Sign in with your password instead
        </button>
      </form>
    </main>
  );
}

