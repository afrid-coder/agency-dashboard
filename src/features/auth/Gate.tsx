// Route guard: signed in → onboarded → has a workspace → unlocked.
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, onSessionProblem } from '../../lib/api.ts';
import { keys, useMe } from '../../lib/queries.ts';
import { LockScreen } from './LockScreen.tsx';
import { ShellLoading } from '../shell/ShellLoading.tsx';
import type { Me } from '../../../shared/types.ts';

export function Gate({ need, children }: { need: 'user' | 'workspace'; children: (me: Me) => ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(
    () =>
      onSessionProblem((code) => {
        if (code === 'locked') void qc.invalidateQueries({ queryKey: keys.me });
        else {
          qc.clear();
          navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}&expired=1`, { replace: true });
        }
      }),
    [qc, navigate, location.pathname, location.search],
  );

  if (me.isPending) return <ShellLoading />;
  if (me.error) {
    const err = me.error as ApiRequestError;
    if (err.status === 401) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return <ShellLoading error={err.message} onRetry={() => void me.refetch()} />;
  }
  const data = me.data;
  if (data.locked) return <LockScreen me={data} />;
  if (need === 'workspace') {
    if (!data.profile.onboarded) return <Navigate to="/onboarding" replace />;
    if (!data.workspace) return <Navigate to="/pending" replace />;
  }
  return <>{children(data)}</>;
}
