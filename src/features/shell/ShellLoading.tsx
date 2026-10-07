import { LumeraLogo } from '../../components/LumeraLogo.tsx';
import { Button } from '../../components/ui.tsx';

export function ShellLoading({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="shell-loading" role={error ? 'alert' : 'status'}>
      <LumeraLogo size={52} className={error ? '' : 'shell-loading-mark'} />
      <p>{error ?? 'Opening your workspace…'}</p>
      {error && onRetry && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
