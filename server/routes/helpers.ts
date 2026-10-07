import type { Context } from 'hono';
import { can } from '../../shared/permissions.ts';
import { permCtx, type AppEnv } from '../auth/context.ts';
import type { Actor } from '../services/tasks.ts';
import { todayIn } from '../../shared/dates.ts';

export const actorOf = (c: Context<AppEnv>): Actor => ({
  orgId: c.get('org').id,
  userId: c.get('user').id,
  userName: c.get('user').name,
  canDeleteAny: can(permCtx(c), 'tasks.deleteAny'),
});

/** The signed-in person's time zone (their profile), used for "today" and display. */
export const tzOf = (c: Context<AppEnv>) => c.get('profile').timezone || c.get('org').timezone;
export const todayOf = (c: Context<AppEnv>) => todayIn(tzOf(c));
