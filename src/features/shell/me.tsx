import { createContext, useContext, type ReactNode } from 'react';
import type { Me, Permission } from '../../../shared/types.ts';
import { useMe } from '../../lib/queries.ts';

const Ctx = createContext<Me | null>(null);

/** Provides the current person and workspace (kept fresh by the /me query). */
export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const live = useMe();
  return <Ctx.Provider value={live.data ?? me}>{children}</Ctx.Provider>;
}

export function useMeData(): Me {
  const me = useContext(Ctx);
  if (!me) throw new Error('useMeData must be used inside MeProvider');
  return me;
}

export const can = (me: Me, p: Permission) => Boolean(me.workspace?.permissions.includes(p));

/** The person's time zone: their profile, or the workspace's. */
export const tzOf = (me: Me) => me.profile.timezone || me.workspace?.timezone || 'UTC';
