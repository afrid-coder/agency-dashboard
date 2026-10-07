// Workspaces, memberships and invitations. Anyone can create an account and
// is signed straight in, but company data needs a membership: the business
// owners join with the private admin code, and everyone else accepts an
// invitation sent to their email.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, count, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { db, isUniqueViolation, schema } from '../db/client.ts';
import { ApiError, forbidden, notFound } from '../http.ts';
import { logActivity } from './activity.ts';
import { notify } from './notifications.ts';
import { publish } from '../realtime.ts';
import { sendMail, templates } from '../mail/mailer.ts';
import { ADMIN_SIGNUP_CODE, APP_URL } from '../env.ts';
import { log } from '../log.ts';
import type { InvitationRow, InviteLookup, PendingInvitation } from '../../shared/types.ts';
import type { Role } from '../../shared/permissions.ts';

const INVITE_DAYS = 7;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

// ─── Company workspace & admin code ──────────────────────────────────────

export const COMPANY_NAME = 'Lumera Creative';

/** The company's real workspace: the oldest one that isn't the demo. */
export async function companyWorkspace() {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.isDemo, false)).orderBy(asc(schema.organizations.createdAt)).limit(1);
  return org ?? null;
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

export async function createWorkspace(userId: string, input: { name: string; timezone: string; isDemo?: boolean }) {
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx.insert(schema.organizations).values({ name: input.name, slug, timezone: input.timezone, isDemo: input.isDemo ?? false }).returning();
        await tx.insert(schema.memberships).values({ orgId: org.id, userId, role: 'owner' });
        await tx.update(schema.profiles).set({ activeOrgId: org.id }).where(eq(schema.profiles.userId, userId));
        await logActivity(tx, { orgId: org.id, actorId: userId, verb: 'created', entityType: 'workspace', entityId: org.id, summary: `created the ${input.name} workspace` });
        return org;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ApiError(409, 'conflict', 'Couldn’t create a unique workspace address. Try a different name.');
}

// Wrong codes are counted per address and overall, so the four digits can't be
// guessed by trying them all: 5 per address per 15 minutes, 12 overall per hour.
const failures = new Map<string, { start: number; count: number }>();
const LIMITS = [
  { key: (ip: string) => `ip:${ip}`, max: 5, windowMs: 15 * 60_000 },
  { key: () => 'all', max: 12, windowMs: 60 * 60_000 },
];

function lockedFor(ip: string): number {
  const now = Date.now();
  let wait = 0;
  for (const l of LIMITS) {
    const w = failures.get(l.key(ip));
    if (w && now - w.start < l.windowMs && w.count >= l.max) wait = Math.max(wait, w.start + l.windowMs - now);
  }
  return wait;
}

function recordFailure(ip: string) {
  const now = Date.now();
  for (const l of LIMITS) {
    const k = l.key(ip);
    const w = failures.get(k);
    if (!w || now - w.start >= l.windowMs) failures.set(k, { start: now, count: 1 });
    else w.count += 1;
  }
}

/** Throws unless `code` is the admin code. Wrong guesses are rate limited. */
export function checkAdminCode(code: unknown, ip: string) {
  const wait = lockedFor(ip);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    throw new ApiError(429, 'admin_code_locked', `Too many wrong admin codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryable: true, retryAfterSeconds: Math.ceil(wait / 1000) });
  }
  const given = Buffer.from(String(code ?? '').trim());
  const expected = Buffer.from(ADMIN_SIGNUP_CODE);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    recordFailure(ip);
    log.warn('admin_code.rejected', {});
    throw new ApiError(403, 'bad_admin_code', 'That admin code isn’t right.', { fields: { adminCode: 'That admin code isn’t right.' } });
  }
}

// One grant at a time, so two owners signing up at once can't create two workspaces.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Gives a person admin access to the company workspace. The first person
 * creates it and becomes its owner; after that, people join as admins
 * (members are promoted). Call only after checkAdminCode.
 */
export function grantAdminAccess(user: { id: string; name: string }, timezone: string): Promise<{ orgId: string; role: Role }> {
  const run = queue.then(() => grant(user, timezone));
  queue = run.catch(() => {});
  return run;
}

async function grant(user: { id: string; name: string }, timezone: string): Promise<{ orgId: string; role: Role }> {
  const company = await companyWorkspace();
  if (!company) {
    const org = await createWorkspace(user.id, { name: COMPANY_NAME, timezone });
    log.info('workspace.created', { orgId: org.id });
    return { orgId: org.id, role: 'owner' };
  }
  const [current] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, company.id), eq(schema.memberships.userId, user.id)));
  if (current && current.role !== 'member') {
    await db.update(schema.profiles).set({ activeOrgId: company.id }).where(eq(schema.profiles.userId, user.id));
    return { orgId: company.id, role: current.role as Role };
  }
  await db.transaction(async (tx) => {
    if (current) await tx.update(schema.memberships).set({ role: 'admin', updatedAt: new Date() }).where(eq(schema.memberships.id, current.id));
    else await tx.insert(schema.memberships).values({ orgId: company.id, userId: user.id, role: 'admin' });
    await tx.update(schema.profiles).set({ activeOrgId: company.id }).where(eq(schema.profiles.userId, user.id));
    await logActivity(tx, { orgId: company.id, actorId: user.id, verb: 'joined', entityType: 'member', entityId: user.id, summary: current ? 'became an admin with the admin code' : 'joined the workspace as an admin' });
  });
  publish(company.id, { topics: ['members', 'activity'], actorId: user.id });
  const leads = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, company.id), inArray(schema.memberships.role, ['owner', 'admin']), ne(schema.memberships.userId, user.id)));
  await notify({ orgId: company.id, actorId: user.id, userIds: leads.map((l) => l.userId), kind: 'admin_joined', title: `${user.name} joined as an admin`, body: 'They signed up with the admin code.', link: '/app/settings/members', dedupeKey: `admin-joined:${user.id}` });
  log.info('workspace.admin_joined', { orgId: company.id });
  return { orgId: company.id, role: 'admin' };
}

// ─── Invitations ─────────────────────────────────────────────────────────

export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select({ i: schema.invitations, inviter: schema.user.name })
    .from(schema.invitations)
    .leftJoin(schema.user, eq(schema.user.id, schema.invitations.invitedBy))
    .where(and(eq(schema.invitations.orgId, orgId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
    .orderBy(asc(schema.invitations.createdAt));
  const now = Date.now();
  return rows.map(({ i, inviter }) => ({
    id: i.id,
    email: i.email,
    role: i.role as Role,
    invitedBy: inviter,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    expired: i.expiresAt.getTime() < now,
  }));
}

async function sendInvite(orgId: string, inviterId: string, email: string, role: string, token: string) {
  const [[org], [inviter]] = await Promise.all([
    db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)),
    db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, inviterId)),
  ]);
  await sendMail(templates.invite(email, org.name, inviter?.name ?? 'A teammate', role, `${APP_URL}/invite/${token}`));
}

export async function invite(orgId: string, actorId: string, email: string, role: 'admin' | 'member') {
  const [already] = await db
    .select({ id: schema.user.id })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.user.email, email)));
  if (already) throw new ApiError(409, 'already_member', `${email} is already in this workspace.`, { fields: { email: 'Already a member.' } });
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const id = await db.transaction(async (tx) => {
    // Re-inviting replaces the open invitation (and its link).
    await tx
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.invitations.orgId, orgId), eq(schema.invitations.email, email), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)));
    const [row] = await tx.insert(schema.invitations).values({ orgId, email, role, tokenHash: hashToken(token), invitedBy: actorId, expiresAt }).returning({ id: schema.invitations.id });
    await logActivity(tx, { orgId, actorId, verb: 'invited', entityType: 'invitation', entityId: row.id, summary: `invited ${email} as ${role}` });
    return row.id;
  });
  try {
    await sendInvite(orgId, actorId, email, role, token);
  } catch {
    throw new ApiError(502, 'mail_failed', 'The invitation was saved but the email could not be sent. Try “Resend” in a moment.', { retryable: true });
  }
  publish(orgId, { topics: ['members'], actorId });
  return id;
}

export async function resendInvite(orgId: string, actorId: string, id: string) {
  const [row] = await db.select().from(schema.invitations).where(and(eq(schema.invitations.orgId, orgId), eq(schema.invitations.id, id), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)));
  if (!row) throw notFound('That invitation');
  return invite(orgId, actorId, row.email, row.role as 'admin' | 'member');
}

export async function revokeInvite(orgId: string, actorId: string, id: string) {
  const res = await db
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invitations.orgId, orgId), eq(schema.invitations.id, id), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
    .returning({ email: schema.invitations.email });
  if (res.length === 0) throw notFound('That invitation');
  await logActivity(db, { orgId, actorId, verb: 'revoked', entityType: 'invitation', entityId: id, summary: `cancelled the invitation for ${res[0].email}` });
  publish(orgId, { topics: ['members'], actorId });
}

async function inviteByToken(token: string) {
  const [row] = await db
    .select({ i: schema.invitations, orgName: schema.organizations.name, inviter: schema.user.name })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.orgId))
    .leftJoin(schema.user, eq(schema.user.id, schema.invitations.invitedBy))
    .where(eq(schema.invitations.tokenHash, hashToken(token)));
  return row ?? null;
}

export async function lookupInvite(token: string): Promise<InviteLookup> {
  const row = await inviteByToken(token);
  if (!row) throw notFound('That invitation');
  const status = row.i.acceptedAt ? 'accepted' : row.i.revokedAt ? 'revoked' : row.i.expiresAt.getTime() < Date.now() ? 'expired' : 'open';
  return { status, orgName: row.orgName, email: row.i.email, role: row.i.role as Role, invitedBy: row.inviter };
}

async function acceptInvitation(invitation: typeof schema.invitations.$inferSelect, user: { id: string; email: string; name: string }, viaLink: boolean) {
  if (invitation.acceptedAt || invitation.revokedAt) throw new ApiError(410, 'invite_closed', 'This invitation is no longer active. Ask an admin to send a new one.');
  if (invitation.expiresAt.getTime() < Date.now()) throw new ApiError(410, 'invite_expired', 'This invitation has expired. Ask an admin to send a new one.');
  if (invitation.email !== user.email.toLowerCase())
    throw new ApiError(403, 'wrong_account', `This invitation is for ${invitation.email}. Sign in with that email address to accept it.`);
  await db.transaction(async (tx) => {
    // Opening the emailed link proves the person can read that inbox.
    if (viaLink) await tx.update(schema.user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(schema.user.id, user.id));
    await tx.insert(schema.memberships).values({ orgId: invitation.orgId, userId: user.id, role: invitation.role }).onConflictDoNothing();
    await tx.update(schema.invitations).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(schema.invitations.id, invitation.id));
    await tx.update(schema.profiles).set({ activeOrgId: invitation.orgId }).where(eq(schema.profiles.userId, user.id));
    await logActivity(tx, { orgId: invitation.orgId, actorId: user.id, verb: 'joined', entityType: 'member', entityId: user.id, summary: `joined the workspace as ${invitation.role}` });
  });
  publish(invitation.orgId, { topics: ['members', 'activity'], actorId: user.id });
  if (invitation.invitedBy)
    await notify({ orgId: invitation.orgId, userIds: [invitation.invitedBy], kind: 'invite_accepted', title: `${user.name} joined the workspace`, link: '/app/settings/workspace', dedupeKey: `joined:${invitation.id}` });
  return invitation.orgId;
}

export async function acceptByToken(token: string, user: { id: string; email: string; name: string }) {
  const row = await inviteByToken(token);
  if (!row) throw notFound('That invitation');
  return acceptInvitation(row.i, user, true);
}

/** Accepting from the pending screen needs a confirmed email; otherwise use the emailed link. */
export async function acceptById(id: string, user: { id: string; email: string; name: string; emailVerified: boolean }) {
  const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, id));
  if (!row) throw notFound('That invitation');
  if (!user.emailVerified) throw new ApiError(403, 'use_link', 'Open the invitation link from your email to join — it confirms this address is yours.');
  return acceptInvitation(row, user, false);
}

/**
 * Open invitations for the pending-access screen. Shown only for confirmed
 * emails: accounts are created without confirmation, so an unconfirmed
 * address proves nothing. Those people join through the emailed link.
 */
export async function pendingInvitationsFor(email: string, emailVerified: boolean): Promise<PendingInvitation[]> {
  if (!emailVerified) return [];
  const rows = await db
    .select({ i: schema.invitations, orgName: schema.organizations.name, inviter: schema.user.name })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.orgId))
    .leftJoin(schema.user, eq(schema.user.id, schema.invitations.invitedBy))
    .where(and(eq(schema.invitations.email, email.toLowerCase()), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  return rows.map(({ i, orgName, inviter }) => ({ id: i.id, orgName, role: i.role as Role, invitedBy: inviter, expiresAt: i.expiresAt.toISOString() }));
}

// ─── Members ─────────────────────────────────────────────────────────────

async function ownerCount(orgId: string) {
  const [{ n }] = await db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, 'owner')));
  return Number(n);
}

export async function changeRole(orgId: string, actor: { id: string; role: Role }, targetId: string, role: Role) {
  const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetId)));
  if (!target) throw notFound('That member');
  if (target.role === role) return;
  const touchesOwner = target.role === 'owner' || role === 'owner';
  if (touchesOwner && actor.role !== 'owner') throw forbidden('Only an owner can grant or remove the owner role.');
  if (target.role === 'owner' && (await ownerCount(orgId)) <= 1) throw new ApiError(409, 'last_owner', 'A workspace needs at least one owner. Make someone else an owner first.');
  const [u] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, targetId));
  await db.transaction(async (tx) => {
    await tx.update(schema.memberships).set({ role, updatedAt: new Date() }).where(eq(schema.memberships.id, target.id));
    await logActivity(tx, { orgId, actorId: actor.id, verb: 'changed_role', entityType: 'member', entityId: targetId, summary: `made ${u?.name ?? 'a member'} ${role === 'admin' ? 'an admin' : `a ${role}`}` });
  });
  publish(orgId, { topics: ['members', 'workspace', 'activity'], actorId: actor.id });
}

export async function removeMember(orgId: string, actor: { id: string; role: Role }, targetId: string) {
  const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetId)));
  if (!target) throw notFound('That member');
  const self = targetId === actor.id;
  if (!self && target.role === 'owner' && actor.role !== 'owner') throw forbidden('Only an owner can remove another owner.');
  if (!self && actor.role === 'member') throw forbidden();
  if (target.role === 'owner' && (await ownerCount(orgId)) <= 1) throw new ApiError(409, 'last_owner', 'A workspace needs at least one owner. Make someone else an owner first.');
  const [u] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, targetId));
  await db.transaction(async (tx) => {
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, target.id));
    // Open work is unassigned so it doesn't sit with someone who can no longer see it.
    const openTasks = tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.orgId, orgId), ne(schema.tasks.status, 'done')));
    await tx.delete(schema.taskAssignees).where(and(eq(schema.taskAssignees.userId, targetId), inArray(schema.taskAssignees.taskId, openTasks)));
    await tx.update(schema.profiles).set({ activeOrgId: null }).where(and(eq(schema.profiles.userId, targetId), eq(schema.profiles.activeOrgId, orgId)));
    await tx.delete(schema.lumeConversations).where(and(eq(schema.lumeConversations.orgId, orgId), eq(schema.lumeConversations.userId, targetId)));
    await logActivity(tx, { orgId, actorId: actor.id, verb: self ? 'left' : 'removed', entityType: 'member', entityId: targetId, summary: self ? 'left the workspace' : `removed ${u?.name ?? 'a member'} from the workspace` });
  });
  publish(orgId, { topics: ['members', 'tasks', 'activity'], actorId: actor.id });
}

