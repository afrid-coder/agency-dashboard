// The signed-in person's account: profile, onboarding, preferences, quick
// unlock PIN, workspace switching, the admin code and accepting invitations.
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { ApiError, readJson } from '../http.ts';
import { IS_EDGE, lumeConfig } from '../env.ts';
import { runRemindersIfDue } from '../services/reminders.ts';
import { loadProfile, requireUser, resolveMembership, sessionIsLocked, type AppEnv } from '../auth/context.ts';
import { auth } from '../auth/auth.ts';
import { hashPin, verifyPin, MAX_PIN_ATTEMPTS } from '../auth/pin.ts';
import { verifyPassword } from 'better-auth/crypto';
import { acceptById, acceptByToken, checkAdminCode, grantAdminAccess, pendingInvitationsFor } from '../services/workspace.ts';
import { clientIp } from '../clientIp.ts';
import { avatarUrl } from '../services/members.ts';
import { enforce } from '../ratelimit.ts';
import { log } from '../log.ts';
import { adminAccessSchema, onboardingSchema, preferencesSchema, profileSchema, securitySchema, setPinSchema, unlockSchema } from '../../shared/schemas.ts';
import { permissionsFor } from '../../shared/permissions.ts';
import type { Me, NotificationPreferences } from '../../shared/types.ts';

export const account = new Hono<AppEnv>();
account.use('*', requireUser);

async function preferences(userId: string): Promise<NotificationPreferences> {
  const [row] = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  const p = row ?? (await db.insert(schema.notificationPreferences).values({ userId }).onConflictDoNothing().returning())[0];
  return {
    eventReminders: p?.eventReminders ?? true,
    defaultReminderMinutes: p?.defaultReminderMinutes ?? 10,
    taskAssigned: p?.taskAssigned ?? true,
    taskDue: p?.taskDue ?? true,
    taskComments: p?.taskComments ?? true,
    emailAssignments: p?.emailAssignments ?? false,
  };
}

account.get('/me', async (c) => {
  if (IS_EDGE) runRemindersIfDue();
  const user = c.get('user');
  const profile = await loadProfile(user.id);
  const [m, prefs, invites, locked, [avatar]] = await Promise.all([
    resolveMembership(user.id, profile.activeOrgId),
    preferences(user.id),
    pendingInvitationsFor(user.email, user.emailVerified),
    sessionIsLocked(c.get('session').id, profile),
    db.select({ at: schema.avatars.updatedAt }).from(schema.avatars).where(eq(schema.avatars.userId, user.id)),
  ]);
  if (m && profile.activeOrgId !== m.org.id) await db.update(schema.profiles).set({ activeOrgId: m.org.id }).where(eq(schema.profiles.userId, user.id));
  const me: Me = {
    user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, avatarUrl: avatarUrl(user.id, avatar?.at ?? null, user.image) },
    profile: { jobTitle: profile.jobTitle, timezone: profile.timezone, onboarded: profile.onboardedAt !== null, hasPin: profile.pinHash !== null, autoLockMinutes: profile.autoLockMinutes },
    preferences: prefs,
    workspaces: m?.all.map((r) => ({ id: r.org.id, name: r.org.name, role: r.role as Me['workspaces'][number]['role'], isDemo: r.org.isDemo })) ?? [],
    workspace: m
      ? {
          id: m.org.id,
          name: m.org.name,
          slug: m.org.slug,
          timezone: m.org.timezone,
          weekStartsOn: m.org.weekStartsOn as 0 | 1,
          defaultTargetCents: m.org.defaultTargetCents,
          membersSeeProfit: m.org.membersSeeProfit,
          isDemo: m.org.isDemo,
          role: m.role,
          permissions: permissionsFor({ role: m.role, membersSeeProfit: m.org.membersSeeProfit }),
        }
      : null,
    pendingInvitations: invites,
    adminCodeAvailable: !m?.all.some((r) => !r.org.isDemo && r.role !== 'member'),
    locked,
    lume: { mode: lumeConfig.mode, model: lumeConfig.mode === 'live' ? lumeConfig.model : null },
  };
  return c.json(me);
});

account.post('/me/onboarding', async (c) => {
  const input = await readJson(c, onboardingSchema);
  const user = c.get('user');
  await auth.api.updateUser({ headers: c.req.raw.headers, body: { name: input.name } });
  await db.update(schema.profiles).set({ jobTitle: input.jobTitle ?? null, timezone: input.timezone, onboardedAt: new Date(), updatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
  return c.json({ ok: true });
});

account.patch('/me/profile', async (c) => {
  const input = await readJson(c, profileSchema);
  const user = c.get('user');
  if (input.name !== undefined) await auth.api.updateUser({ headers: c.req.raw.headers, body: { name: input.name } });
  const set: Partial<typeof schema.profiles.$inferInsert> = { updatedAt: new Date() };
  if (input.jobTitle !== undefined) set.jobTitle = input.jobTitle || null;
  if (input.timezone !== undefined) set.timezone = input.timezone;
  await db.update(schema.profiles).set(set).where(eq(schema.profiles.userId, user.id));
  return c.json({ ok: true });
});

const avatarSchema = z.object({ dataUrl: z.string().max(700_000) });
account.put('/me/avatar', async (c) => {
  const { dataUrl } = await readJson(c, avatarSchema);
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ApiError(422, 'invalid', 'Upload a PNG, JPEG or WebP image.');
  if (m[2].length > 680_000) throw new ApiError(413, 'too_large', 'That image is too large. Choose one under 500 KB.');
  const user = c.get('user');
  await db
    .insert(schema.avatars)
    .values({ userId: user.id, mime: m[1], data: m[2] })
    .onConflictDoUpdate({ target: schema.avatars.userId, set: { mime: m[1], data: m[2], updatedAt: new Date() } });
  return c.json({ ok: true });
});

account.delete('/me/avatar', async (c) => {
  await db.delete(schema.avatars).where(eq(schema.avatars.userId, c.get('user').id));
  return c.json({ ok: true });
});

account.put('/me/preferences', async (c) => {
  const input = await readJson(c, preferencesSchema);
  const userId = c.get('user').id;
  await db
    .insert(schema.notificationPreferences)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: schema.notificationPreferences.userId, set: { ...input, updatedAt: new Date() } });
  return c.json(await preferences(userId));
});

// ─── Quick unlock PIN ────────────────────────────────────────────────────

async function checkPassword(userId: string, password: string) {
  const [acct] = await db.select({ password: schema.account.password }).from(schema.account).where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')));
  if (!acct?.password || !(await verifyPassword({ hash: acct.password, password }))) throw new ApiError(403, 'bad_password', 'That password isn’t right.', { fields: { password: 'That password isn’t right.' } });
}

account.put('/me/pin', async (c) => {
  const user = c.get('user');
  enforce(`pin-set:${user.id}`, 5, 10 * 60_000);
  const input = await readJson(c, setPinSchema);
  await checkPassword(user.id, input.password);
  if (/^(\d)\1{3}$/.test(input.pin) || ['1234', '4321', '0123', '9876'].includes(input.pin)) throw new ApiError(422, 'invalid', 'Choose a less predictable PIN.', { fields: { pin: 'Choose a less predictable PIN.' } });
  await db.update(schema.profiles).set({ pinHash: await hashPin(input.pin), pinUpdatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
  await db.insert(schema.sessionLocks).values({ sessionId: c.get('session').id }).onConflictDoUpdate({ target: schema.sessionLocks.sessionId, set: { lockedAt: null, failedAttempts: 0, lastSeenAt: new Date() } });
  log.info('pin.set', { userId: user.id });
  return c.json({ ok: true });
});

account.delete('/me/pin', async (c) => {
  const user = c.get('user');
  const profile = c.get('profile');
  if (await sessionIsLocked(c.get('session').id, profile)) throw new ApiError(423, 'locked', 'Unlock your workspace first.');
  await db.update(schema.profiles).set({ pinHash: null, pinUpdatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
  return c.json({ ok: true });
});

account.patch('/me/security', async (c) => {
  const input = await readJson(c, securitySchema);
  await db.update(schema.profiles).set({ autoLockMinutes: input.autoLockMinutes }).where(eq(schema.profiles.userId, c.get('user').id));
  return c.json({ ok: true });
});

account.post('/session/lock', async (c) => {
  if (!c.get('profile').pinHash) throw new ApiError(409, 'no_pin', 'Set a quick-unlock PIN in Settings → Security before locking.');
  const sessionId = c.get('session').id;
  await db.insert(schema.sessionLocks).values({ sessionId, lockedAt: new Date() }).onConflictDoUpdate({ target: schema.sessionLocks.sessionId, set: { lockedAt: new Date() } });
  return c.json({ ok: true });
});

account.post('/session/unlock', async (c) => {
  const { pin } = await readJson(c, unlockSchema);
  const profile = c.get('profile');
  const session = c.get('session');
  if (!profile.pinHash) return c.json({ ok: true });
  enforce(`unlock:${session.id}`, 10, 60_000);
  const [lock] = await db.select().from(schema.sessionLocks).where(eq(schema.sessionLocks.sessionId, session.id));
  if (await verifyPin(pin, profile.pinHash)) {
    await db.insert(schema.sessionLocks).values({ sessionId: session.id }).onConflictDoUpdate({ target: schema.sessionLocks.sessionId, set: { lockedAt: null, failedAttempts: 0, lastSeenAt: new Date() } });
    return c.json({ ok: true });
  }
  const attempts = (lock?.failedAttempts ?? 0) + 1;
  if (attempts >= MAX_PIN_ATTEMPTS) {
    // Too many wrong PINs: end this session. A full password sign-in is required.
    await db.delete(schema.session).where(eq(schema.session.id, session.id));
    log.warn('pin.session_revoked', { userId: c.get('user').id });
    throw new ApiError(401, 'unauthenticated', 'Too many incorrect PINs. For your security you’ve been signed out — sign in with your password.');
  }
  await db.update(schema.sessionLocks).set({ failedAttempts: attempts }).where(eq(schema.sessionLocks.sessionId, session.id));
  throw new ApiError(403, 'bad_pin', `That PIN isn’t right. ${MAX_PIN_ATTEMPTS - attempts} attempt${MAX_PIN_ATTEMPTS - attempts === 1 ? '' : 's'} left before you’re signed out.`);
});

// ─── Workspaces ──────────────────────────────────────────────────────────

account.post('/me/active-workspace', async (c) => {
  const { orgId } = await readJson(c, z.object({ orgId: z.string().uuid() }));
  const user = c.get('user');
  const m = await resolveMembership(user.id, orgId);
  if (!m || m.org.id !== orgId) throw new ApiError(403, 'forbidden', 'You’re not a member of that workspace.');
  await db.update(schema.profiles).set({ activeOrgId: orgId }).where(eq(schema.profiles.userId, user.id));
  return c.json({ ok: true });
});

/** For the business owners: the admin code joins the company workspace as an admin. */
account.post('/me/admin-access', async (c) => {
  const user = c.get('user');
  const input = await readJson(c, adminAccessSchema);
  await checkAdminCode(input.code, clientIp(c));
  const profile = c.get('profile');
  const timezone = input.timezone ?? profile.timezone;
  if (!profile.onboardedAt) await db.update(schema.profiles).set({ timezone, onboardedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
  return c.json(await grantAdminAccess(user, timezone));
});

account.post('/invites/:token/accept', async (c) => {
  const user = c.get('user');
  enforce(`accept:${user.id}`, 10, 10 * 60_000);
  const orgId = await acceptByToken(c.req.param('token'), user);
  return c.json({ orgId });
});

account.post('/me/invitations/:id/accept', async (c) => {
  const user = c.get('user');
  const orgId = await acceptById(c.req.param('id'), user);
  return c.json({ orgId });
});
