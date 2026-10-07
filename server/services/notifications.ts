// In-app notifications. Created after the related change is committed,
// filtered by each person's preferences, deduplicated per person, and pushed
// live to their open sessions.
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { publish } from '../realtime.ts';
import { log } from '../log.ts';
import { sendMail, templates } from '../mail/mailer.ts';
import { APP_URL } from '../env.ts';
import type { NotificationItem, Page } from '../../shared/types.ts';

type PrefKey = 'eventReminders' | 'taskAssigned' | 'taskDue' | 'taskComments';

export interface NotifyInput {
  orgId: string;
  userIds: string[];
  kind: 'event_reminder' | 'task_assigned' | 'task_due' | 'task_comment' | 'invite_accepted' | 'admin_joined' | 'lume';
  pref?: PrefKey;
  title: string;
  body?: string;
  link?: string | null;
  dedupeKey: string;
  /** Actor is never notified about their own change. */
  actorId?: string | null;
  email?: { actorName: string; taskTitle: string };
}

export async function notify(n: NotifyInput) {
  const targets = [...new Set(n.userIds)].filter((id) => id !== n.actorId);
  if (targets.length === 0) return;
  try {
    const prefs = await db.select().from(schema.notificationPreferences).where(inArray(schema.notificationPreferences.userId, targets));
    const byUser = new Map(prefs.map((p) => [p.userId, p]));
    const allowed = targets.filter((id) => !n.pref || byUser.get(id)?.[n.pref] !== false);
    if (allowed.length === 0) return;
    const inserted = await db
      .insert(schema.notifications)
      .values(allowed.map((userId) => ({ orgId: n.orgId, userId, kind: n.kind, title: n.title, body: n.body ?? '', link: n.link ?? null, dedupeKey: n.dedupeKey })))
      .onConflictDoNothing()
      .returning({ userId: schema.notifications.userId });
    const delivered = inserted.map((r) => r.userId);
    if (delivered.length === 0) return;
    publish(n.orgId, {
      topics: ['notifications'],
      actorId: n.actorId ?? null,
      userIds: delivered,
      notification: { title: n.title, body: n.body ?? '', link: n.link ?? null, kind: n.kind },
    });
    if (n.kind === 'task_assigned' && n.email) {
      const emailTo = delivered.filter((id) => byUser.get(id)?.emailAssignments);
      if (emailTo.length) {
        const users = await db.select({ email: schema.user.email }).from(schema.user).where(inArray(schema.user.id, emailTo));
        for (const u of users) void sendMail(templates.assigned(u.email, n.email.actorName, n.email.taskTitle, `${APP_URL}${n.link ?? '/app'}`)).catch(() => log.warn('mail.assignment_failed'));
      }
    }
  } catch (err) {
    // Notifications never break the change that triggered them.
    log.error('notify.failed', { kind: n.kind, message: (err as Error).message });
  }
}

export async function listNotifications(orgId: string, userId: string, cursor?: string): Promise<Page<NotificationItem> & { unread: number }> {
  const conds = [eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId)];
  if (cursor) {
    const at = new Date(cursor);
    if (!Number.isNaN(at.getTime())) conds.push(lt(schema.notifications.createdAt, at));
  }
  const rows = await db.select().from(schema.notifications).where(and(...conds)).orderBy(desc(schema.notifications.createdAt)).limit(31);
  const unreadRows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .limit(100);
  const items = rows.slice(0, 30).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.readAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, nextCursor: rows.length > 30 ? rows[29].createdAt.toISOString() : null, unread: unreadRows.length };
}

export async function markRead(orgId: string, userId: string, ids: string[] | 'all') {
  const conds = [eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)];
  if (ids !== 'all') conds.push(inArray(schema.notifications.id, ids.slice(0, 100)));
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(...conds));
}
