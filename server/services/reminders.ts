// Background jobs: event reminders, due-today notices and housekeeping.
// Node runs them every minute in the server process. On Supabase there is no
// background process, so they run off ordinary traffic (runRemindersIfDue).
// Notifications are deduplicated, so overlapping runs never send the same
// reminder twice.
import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import { waitUntil } from '../runtime.ts';
import { db, schema } from '../db/client.ts';
import { listOccurrences, eventHref } from './events.ts';
import { notify } from './notifications.ts';
import { purgeDeletedTasks } from './tasks.ts';
import { log } from '../log.ts';
import { addDays, formatInstant, hourIn, todayIn } from '../../shared/dates.ts';

let running = false;
let lastHousekeeping = 0;

export async function runReminders(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const orgs = await db.select({ id: schema.organizations.id, timezone: schema.organizations.timezone }).from(schema.organizations);
    for (const org of orgs) {
      const today = todayIn(org.timezone, now);
      const occurrences = await listOccurrences(org.id, null, { from: addDays(today, -1), to: addDays(today, 8), tz: org.timezone, scope: 'team' });
      for (const o of occurrences) {
        if (o.allDay || o.reminderMinutes == null) continue;
        const start = new Date(o.startsAt!);
        const remindAt = start.getTime() - o.reminderMinutes * 60_000;
        if (now.getTime() < remindAt || now.getTime() > start.getTime()) continue;
        const minutes = Math.max(Math.round((start.getTime() - now.getTime()) / 60_000), 0);
        await notify({
          orgId: org.id,
          userIds: [...o.attendeeIds, ...(o.createdBy ? [o.createdBy] : [])],
          kind: 'event_reminder',
          pref: 'eventReminders',
          title: minutes <= 1 ? `${o.title} is starting now` : `${o.title} starts in ${minutes} minutes`,
          body: `${formatInstant(start, org.timezone, { hour: 'numeric', minute: '2-digit' })}${o.location ? ` · ${o.location}` : ''}`,
          link: eventHref(o, org.timezone),
          dedupeKey: `reminder:${o.key}`,
        });
      }

      if (hourIn(org.timezone, now) >= 8) {
        const due = await db
          .select({ id: schema.tasks.id, title: schema.tasks.title, userId: schema.taskAssignees.userId })
          .from(schema.tasks)
          .innerJoin(schema.taskAssignees, eq(schema.taskAssignees.taskId, schema.tasks.id))
          .where(and(eq(schema.tasks.orgId, org.id), eq(schema.tasks.dueDate, today), ne(schema.tasks.status, 'done'), isNull(schema.tasks.deletedAt)));
        for (const t of due)
          await notify({
            orgId: org.id,
            userIds: [t.userId],
            kind: 'task_due',
            pref: 'taskDue',
            title: `“${t.title}” is due today`,
            link: `/app/tasks?task=${t.id}`,
            dedupeKey: `due:${t.id}:${today}`,
          });
      }
    }

    if (now.getTime() - lastHousekeeping > 6 * 3_600_000) {
      lastHousekeeping = now.getTime();
      await purgeDeletedTasks();
      await db.delete(schema.notifications).where(lt(schema.notifications.createdAt, new Date(now.getTime() - 90 * 86_400_000)));
      await db.delete(schema.verification).where(lt(schema.verification.expiresAt, new Date(now.getTime() - 86_400_000)));
      await db.delete(schema.session).where(lt(schema.session.expiresAt, now));
      await db.delete(schema.lumeBriefings).where(lt(schema.lumeBriefings.generatedAt, new Date(now.getTime() - 14 * 86_400_000)));
    }
  } catch (err) {
    log.error('reminders.failed', { message: (err as Error).message });
  } finally {
    running = false;
  }
}

/** Runs the jobs at most once a minute across all instances, after the current response. */
export function runRemindersIfDue() {
  const C = schema.securityCounters;
  const job = (async () => {
    const claimed = await db
      .insert(C)
      .values({ key: 'job:reminders', windowStart: new Date(), count: 1 })
      .onConflictDoUpdate({ target: C.key, set: { windowStart: sql`now()`, count: sql`${C.count} + 1` }, setWhere: sql`${C.windowStart} < now() - interval '60 seconds'` })
      .returning({ key: C.key });
    if (claimed.length) await runReminders();
  })().catch((err) => log.warn('reminders.failed', { message: String(err).slice(0, 200) }));
  waitUntil(job);
}

export function startScheduler() {
  const timer = setInterval(() => void runReminders(), 60_000);
  timer.unref();
  setTimeout(() => void runReminders(), 5_000).unref();
}
