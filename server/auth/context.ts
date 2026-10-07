// Request context: who is calling, which workspace they are acting in, and
// what they may do there. Every data endpoint runs behind requireWorkspace,
// and every query below it is scoped to c.get('org').id.
import type { Context, MiddlewareHandler } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { auth } from './auth.ts';
import { db, schema } from '../db/client.ts';
import { APP_ORIGIN } from '../env.ts';
import { ApiError, forbidden } from '../http.ts';
import { can, type Permission, type PermissionContext, type Role } from '../../shared/permissions.ts';

export type UserRow = typeof schema.user.$inferSelect;
export type SessionRow = typeof schema.session.$inferSelect;
export type OrgRow = typeof schema.organizations.$inferSelect;
export type ProfileRow = typeof schema.profiles.$inferSelect;

export interface AppEnv {
  Variables: {
    user: UserRow;
    session: SessionRow;
    profile: ProfileRow;
    org: OrgRow;
    role: Role;
  };
}

/**
 * Cross-site request protection for the app API: writes must come from our
 * own origin and carry a header that plain HTML forms cannot send.
 * Better Auth applies its own origin checks to /api/auth/*.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !c.req.path.startsWith('/api/auth/')) {
    const origin = c.req.header('origin');
    if (c.req.header('x-lumera-client') !== '1' || (origin && origin !== APP_ORIGIN)) {
      throw new ApiError(403, 'csrf', 'This request was blocked because it did not come from the Lumera Creative app.');
    }
  }
  await next();
};

export async function loadProfile(userId: string): Promise<ProfileRow> {
  const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (row) return row;
  const [created] = await db.insert(schema.profiles).values({ userId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return again;
}

/** Signed in. Does not require a workspace. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) throw new ApiError(401, 'unauthenticated', 'Your session has ended. Please sign in again.');
  const user = result.user as unknown as UserRow;
  c.set('user', user);
  c.set('session', result.session as unknown as SessionRow);
  c.set('profile', await loadProfile(user.id));
  await next();
};

/** The caller's membership in their active workspace, or the earliest one they have. */
export async function resolveMembership(userId: string, preferredOrgId: string | null) {
  const rows = await db
    .select({ org: schema.organizations, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.organizations.isDemo), asc(schema.memberships.createdAt));
  if (rows.length === 0) return null;
  const chosen = rows.find((r) => r.org.id === preferredOrgId) ?? rows[0];
  return { org: chosen.org, role: chosen.role as Role, all: rows };
}

/**
 * Quick-unlock state. Only applies when the person set a PIN: the session
 * locks after their chosen idle time (or when they lock it) until the PIN or
 * a fresh password sign-in unlocks it.
 */
export async function sessionIsLocked(sessionId: string, profile: ProfileRow): Promise<boolean> {
  if (!profile.pinHash) return false;
  const now = new Date();
  const [row] = await db.select().from(schema.sessionLocks).where(eq(schema.sessionLocks.sessionId, sessionId));
  if (!row) {
    await db.insert(schema.sessionLocks).values({ sessionId, lastSeenAt: now }).onConflictDoNothing();
    return false;
  }
  if (row.lockedAt) return true;
  const idle = now.getTime() - row.lastSeenAt.getTime();
  if (idle > profile.autoLockMinutes * 60_000) {
    await db.update(schema.sessionLocks).set({ lockedAt: now }).where(eq(schema.sessionLocks.sessionId, sessionId));
    return true;
  }
  if (idle > 30_000) await db.update(schema.sessionLocks).set({ lastSeenAt: now }).where(eq(schema.sessionLocks.sessionId, sessionId));
  return false;
}

/** Member of a workspace, session unlocked. Sets org and role. */
export const requireWorkspace: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  const profile = c.get('profile');
  if (await sessionIsLocked(c.get('session').id, profile)) throw new ApiError(423, 'locked', 'Your workspace is locked. Enter your PIN to continue.');
  const m = await resolveMembership(user.id, profile.activeOrgId);
  if (!m) throw new ApiError(403, 'no_workspace', 'Your account doesn’t have access to a workspace yet.');
  c.set('org', m.org);
  c.set('role', m.role);
  await next();
};

export const permCtx = (c: Context<AppEnv>): PermissionContext => ({ role: c.get('role'), membersSeeProfit: c.get('org').membersSeeProfit });

export function assertCan(c: Context<AppEnv>, permission: Permission, message?: string) {
  if (!can(permCtx(c), permission)) throw forbidden(message);
}

export async function isMember(orgId: string, userId: string) {
  const [row] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  return row ? (row.role as Role) : null;
}
