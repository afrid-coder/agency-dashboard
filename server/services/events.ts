// Calendar events. Timed events are stored as UTC instants plus the zone they
// were scheduled in; recurring series are expanded on read so each meeting
// keeps its local start time across daylight-saving changes. Single
// occurrences can be changed or cancelled through event_exceptions.
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, gte, or, type SQL } from 'drizzle-orm';
import { db, isUniqueViolation, schema, type Queryable } from '../db/client.ts';
import { ApiError, forbidden, notFound } from '../http.ts';
import { logActivity } from './activity.ts';
import { assertMembers } from './members.ts';
import { assertProject, type Actor } from './tasks.ts';
import { publish } from '../realtime.ts';
import { addDays, dateInZone, diffDays, formatInstant, formatISO, startOfDayUtc, timeInZone, zonedToUtc } from '../../shared/dates.ts';
import { normalizeRecurrence, occurrenceDates, type Recurrence } from '../../shared/recurrence.ts';
import type { EventOccurrence } from '../../shared/types.ts';

const E = schema.events;
type EventRow = typeof E.$inferSelect;
type ExceptionRow = typeof schema.eventExceptions.$inferSelect;

interface Override {
  title?: string;
  description?: string;
  location?: string;
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
}

export interface EventInput {
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  date: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  endDateTimed?: string | null;
  timezone: string;
  projectId: string | null;
  attendeeIds: string[];
  visibility: 'team' | 'private';
  reminderMinutes: number | null;
  recurrence: Recurrence | null;
  idempotencyKey?: string;
}

/** Converts form input (local date + times in a zone) into stored columns. */
export function toStorage(input: EventInput) {
  if (input.allDay) {
    const endDate = input.endDate && input.endDate >= input.date ? input.endDate : input.date;
    return { allDay: true, startDate: input.date, endDate, startsAt: null, endsAt: null };
  }
  const startsAt = zonedToUtc(input.date, input.startTime!, input.timezone);
  const endsAt = zonedToUtc(input.endDateTimed ?? input.date, input.endTime!, input.timezone);
  if (endsAt <= startsAt) throw new ApiError(422, 'invalid', 'The event must end after it starts.', { fields: { endTime: 'Must be after the start time.' } });
  if (endsAt.getTime() - startsAt.getTime() > 14 * 86_400_000) throw new ApiError(422, 'invalid', 'Timed events can last up to 14 days. Use an all-day event for longer spans.');
  return { allDay: false, startDate: null, endDate: null, startsAt, endsAt };
}

function canSee(e: EventRow, attendees: string[], userId: string) {
  return e.visibility === 'team' || e.createdBy === userId || attendees.includes(userId);
}

function occurrence(e: EventRow, attendees: string[], projectName: string | null, key: string | null, fields: Partial<EventOccurrence>, isException: boolean): EventOccurrence {
  return {
    key: key ? `${e.id}:${key}` : e.id,
    eventId: e.id,
    occurrenceKey: key,
    recurring: e.recurrence !== null,
    recurrence: (e.recurrence as Recurrence | null) ?? null,
    isException,
    title: e.title,
    description: e.description,
    location: e.location,
    allDay: e.allDay,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    startDate: e.startDate,
    endDate: e.endDate,
    timezone: e.timezone,
    projectId: e.projectId,
    projectName,
    visibility: e.visibility as 'team' | 'private',
    attendeeIds: attendees,
    reminderMinutes: e.reminderMinutes,
    createdBy: e.createdBy,
    version: e.version,
    ...fields,
  };
}

/** Occurrences of one event overlapping [rangeStart, rangeEnd) (instants) / [from, to] (dates). */
export function expandEvent(e: EventRow, attendees: string[], projectName: string | null, exceptions: ExceptionRow[], from: string, to: string, rangeStart: Date, rangeEnd: Date): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const exMap = new Map(exceptions.map((x) => [x.occurrenceKey, x]));
  const rule = e.recurrence as Recurrence | null;

  if (e.allDay) {
    const span = diffDays(e.endDate!, e.startDate!);
    const starts = rule ? occurrenceDates(e.startDate!, rule, addDays(from, -span), to) : [e.startDate!];
    for (const d of starts) {
      const ex = rule ? exMap.get(d) : undefined;
      if (ex?.cancelled) continue;
      const o = (ex?.override ?? {}) as Override;
      const startDate = o.startDate ?? d;
      const endDate = o.endDate ?? addDays(d, span);
      if (endDate < from || startDate > to) continue;
      out.push(occurrence(e, attendees, projectName, rule ? d : null, { startDate, endDate, title: o.title ?? e.title, description: o.description ?? e.description, location: o.location ?? e.location }, Boolean(ex)));
    }
    return out;
  }

  const dur = e.endsAt!.getTime() - e.startsAt!.getTime();
  if (!rule) {
    if (e.startsAt! < rangeEnd && e.endsAt! > rangeStart) out.push(occurrence(e, attendees, projectName, null, {}, false));
    return out;
  }
  const localDate = dateInZone(e.startsAt!, e.timezone);
  const localTime = timeInZone(e.startsAt!, e.timezone);
  const spanDays = Math.ceil(dur / 86_400_000);
  for (const d of occurrenceDates(localDate, rule, addDays(from, -2 - spanDays), addDays(to, 2))) {
    const start = zonedToUtc(d, localTime, e.timezone);
    const key = start.toISOString();
    const ex = exMap.get(key);
    if (ex?.cancelled) continue;
    const o = (ex?.override ?? {}) as Override;
    const s = o.startsAt ? new Date(o.startsAt) : start;
    const en = o.endsAt ? new Date(o.endsAt) : new Date(start.getTime() + dur);
    if (!(s < rangeEnd && en > rangeStart)) continue;
    out.push(
      occurrence(e, attendees, projectName, key, { startsAt: s.toISOString(), endsAt: en.toISOString(), title: o.title ?? e.title, description: o.description ?? e.description, location: o.location ?? e.location }, Boolean(ex)),
    );
  }
  return out;
}

export interface RangeQuery {
  from: string;
  to: string;
  tz: string;
  scope: 'team' | 'mine';
  projectId?: string;
  memberId?: string;
  eventIds?: string[];
}

/** Every occurrence visible to `userId` in the date range (dates are in `tz`). `null` = system access. */
export async function listOccurrences(orgId: string, userId: string | null, q: RangeQuery): Promise<EventOccurrence[]> {
  const rangeStart = startOfDayUtc(q.from, q.tz);
  const rangeEnd = startOfDayUtc(addDays(q.to, 1), q.tz);
  const conds: SQL[] = [
    eq(E.orgId, orgId),
    isNull(E.deletedAt),
    or(
      and(isNotNull(E.recurrence), or(lt(E.startsAt, rangeEnd), lte(E.startDate, q.to))),
      and(eq(E.allDay, false), lt(E.startsAt, rangeEnd), gt(E.endsAt, rangeStart)),
      and(eq(E.allDay, true), lte(E.startDate, q.to), gte(E.endDate, q.from)),
    )!,
  ];
  if (q.projectId) conds.push(eq(E.projectId, q.projectId));
  if (q.eventIds) conds.push(inArray(E.id, q.eventIds.length ? q.eventIds : ['00000000-0000-0000-0000-000000000000']));
  const rows = await db.select({ e: E, projectName: schema.projects.name }).from(E).leftJoin(schema.projects, eq(schema.projects.id, E.projectId)).where(and(...conds));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.e.id);
  const [att, exc] = await Promise.all([
    db.select().from(schema.eventAttendees).where(inArray(schema.eventAttendees.eventId, ids)),
    db.select().from(schema.eventExceptions).where(inArray(schema.eventExceptions.eventId, ids)),
  ]);
  const attendees = new Map<string, string[]>();
  for (const a of att) attendees.set(a.eventId, [...(attendees.get(a.eventId) ?? []), a.userId]);
  const exceptions = new Map<string, ExceptionRow[]>();
  for (const x of exc) exceptions.set(x.eventId, [...(exceptions.get(x.eventId) ?? []), x]);

  const out: EventOccurrence[] = [];
  for (const { e, projectName } of rows) {
    const people = (attendees.get(e.id) ?? []).sort();
    // userId null = system access (reminders); otherwise private events stay private.
    if (userId !== null && !canSee(e, people, userId)) continue;
    if (userId !== null && q.scope === 'mine' && e.createdBy !== userId && !people.includes(userId)) continue;
    if (q.memberId && e.createdBy !== q.memberId && !people.includes(q.memberId)) continue;
    out.push(...expandEvent(e, people, projectName, exceptions.get(e.id) ?? [], q.from, q.to, rangeStart, rangeEnd));
  }
  return out.sort((a, b) => sortKey(a, q.tz).localeCompare(sortKey(b, q.tz)));
}

const sortKey = (o: EventOccurrence, tz: string) => (o.allDay ? `${o.startDate}T00:00` : `${dateInZone(new Date(o.startsAt!), tz)}T${timeInZone(new Date(o.startsAt!), tz)}`) + (o.allDay ? '0' : '1');

async function eventRow(q: Queryable, orgId: string, id: string, lock = false) {
  const base = q.select().from(E).where(and(eq(E.orgId, orgId), eq(E.id, id), isNull(E.deletedAt)));
  const [row] = lock ? await base.for('update') : await base;
  if (!row) throw notFound('That event');
  return row;
}

export async function getEventForUser(orgId: string, userId: string, id: string) {
  const row = await eventRow(db, orgId, id);
  const people = (await db.select().from(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, id))).map((a) => a.userId).sort();
  if (!canSee(row, people, userId)) throw notFound('That event');
  return { row, attendees: people };
}

/** Other visible events that overlap the proposed time for any of these people. */
export async function findConflicts(orgId: string, viewerId: string, people: string[], startsAt: Date, endsAt: Date, tz: string, excludeEventId?: string) {
  if (people.length === 0) return [];
  const from = addDays(dateInZone(startsAt, tz), -1);
  const to = addDays(dateInZone(endsAt, tz), 1);
  const all = await listOccurrences(orgId, viewerId, { from, to, tz, scope: 'team' });
  return all.filter(
    (o) =>
      !o.allDay &&
      o.eventId !== excludeEventId &&
      new Date(o.startsAt!) < endsAt &&
      new Date(o.endsAt!) > startsAt &&
      (o.attendeeIds.some((a) => people.includes(a)) || (o.createdBy !== null && people.includes(o.createdBy))),
  );
}

function reminderFor(input: EventInput) {
  return input.reminderMinutes;
}

export async function createEvent(actor: Actor, input: EventInput, source: 'manual' | 'lume' = 'manual'): Promise<{ eventId: string; duplicate: boolean }> {
  if (input.idempotencyKey) {
    const [existing] = await db.select({ id: E.id }).from(E).where(and(eq(E.orgId, actor.orgId), eq(E.idempotencyKey, input.idempotencyKey)));
    if (existing) return { eventId: existing.id, duplicate: true };
  }
  const stored = toStorage(input);
  try {
    const id = await db.transaction(async (tx) => {
      await assertProject(tx, actor.orgId, input.projectId);
      const people = await assertMembers(tx, actor.orgId, input.attendeeIds, 'attendeeIds');
      const [row] = await tx
        .insert(E)
        .values({
          orgId: actor.orgId,
          title: input.title,
          description: input.description,
          location: input.location,
          ...stored,
          timezone: input.timezone,
          projectId: input.projectId,
          visibility: input.visibility,
          reminderMinutes: reminderFor(input),
          recurrence: input.recurrence ? normalizeRecurrence(input.recurrence, input.date) : null,
          createdBy: actor.userId,
          source,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning({ id: E.id });
      if (people.length) await tx.insert(schema.eventAttendees).values(people.map((userId) => ({ eventId: row.id, userId, response: userId === actor.userId ? 'accepted' : 'pending' })));
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'scheduled', entityType: 'event', entityId: row.id, summary: `scheduled “${input.title}” for ${whenLabel(input)}`, restricted: false });
      return row.id;
    });
    publish(actor.orgId, { topics: ['events', 'activity'], actorId: actor.userId });
    return { eventId: id, duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err, 'event_idempotency_uq') && input.idempotencyKey) {
      const [existing] = await db.select({ id: E.id }).from(E).where(and(eq(E.orgId, actor.orgId), eq(E.idempotencyKey, input.idempotencyKey)));
      return { eventId: existing.id, duplicate: true };
    }
    throw err;
  }
}

function whenLabel(input: EventInput) {
  const day = formatISO(input.date, { weekday: 'short', month: 'short', day: 'numeric' });
  return input.allDay ? day : `${day}, ${formatInstant(zonedToUtc(input.date, input.startTime!, input.timezone), input.timezone, { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * scope 'series' edits the event (and every occurrence); scope 'occurrence'
 * stores an exception for one occurrence of a recurring series.
 */
export async function updateEvent(actor: Actor, id: string, scope: 'series' | 'occurrence', occurrenceKey: string | null | undefined, version: number, input: EventInput) {
  const stored = toStorage(input);
  await db.transaction(async (tx) => {
    const current = await eventRow(tx, actor.orgId, id, true);
    const people = (await tx.select().from(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, id))).map((a) => a.userId);
    if (!canSee(current, people, actor.userId)) throw notFound('That event');
    if (current.visibility === 'private' && current.createdBy !== actor.userId) throw forbidden('Only the organizer can change a private event.');
    if (current.version !== version)
      throw new ApiError(409, 'conflict', 'Someone changed this event while you were editing. Reload it to see the latest version, then make your change again.', { details: { version: current.version } });

    if (scope === 'occurrence') {
      if (!current.recurrence || !occurrenceKey) throw new ApiError(422, 'invalid', 'Choose which occurrence to change.');
      const override: Override = { title: input.title, description: input.description, location: input.location };
      if (current.allDay) {
        if (!stored.allDay) throw new ApiError(422, 'invalid', 'To switch between all-day and timed, edit the whole series.');
        override.startDate = stored.startDate!;
        override.endDate = stored.endDate!;
      } else {
        if (stored.allDay) throw new ApiError(422, 'invalid', 'To switch between all-day and timed, edit the whole series.');
        override.startsAt = stored.startsAt!.toISOString();
        override.endsAt = stored.endsAt!.toISOString();
      }
      await tx
        .insert(schema.eventExceptions)
        .values({ eventId: id, occurrenceKey, override })
        .onConflictDoUpdate({ target: [schema.eventExceptions.eventId, schema.eventExceptions.occurrenceKey], set: { override, cancelled: false, updatedAt: new Date() } });
      await tx.update(E).set({ version: current.version + 1, updatedAt: new Date() }).where(eq(E.id, id));
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'updated', entityType: 'event', entityId: id, summary: `changed one “${input.title}” occurrence to ${whenLabel(input)}` });
      return;
    }

    await assertProject(tx, actor.orgId, input.projectId);
    const nextPeople = await assertMembers(tx, actor.orgId, input.attendeeIds, 'attendeeIds');
    const recurrence = input.recurrence ? normalizeRecurrence(input.recurrence, input.date) : null;
    const timingChanged =
      JSON.stringify(recurrence) !== JSON.stringify(current.recurrence) ||
      stored.allDay !== current.allDay ||
      stored.startsAt?.getTime() !== current.startsAt?.getTime() ||
      stored.startDate !== current.startDate;
    await tx
      .update(E)
      .set({
        title: input.title,
        description: input.description,
        location: input.location,
        ...stored,
        timezone: input.timezone,
        projectId: input.projectId,
        visibility: input.visibility,
        reminderMinutes: reminderFor(input),
        recurrence,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(E.id, id));
    // Individual changes are keyed to the old occurrence times; when the series timing moves they no longer apply.
    if (timingChanged) await tx.delete(schema.eventExceptions).where(eq(schema.eventExceptions.eventId, id));
    const removed = people.filter((p) => !nextPeople.includes(p));
    const added = nextPeople.filter((p) => !people.includes(p));
    if (removed.length) await tx.delete(schema.eventAttendees).where(and(eq(schema.eventAttendees.eventId, id), inArray(schema.eventAttendees.userId, removed)));
    if (added.length) await tx.insert(schema.eventAttendees).values(added.map((userId) => ({ eventId: id, userId })));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'updated', entityType: 'event', entityId: id, summary: `updated “${input.title}”${current.recurrence ? ' (all occurrences)' : ''}` });
  });
  publish(actor.orgId, { topics: ['events', 'activity'], actorId: actor.userId });
}

export async function deleteEvent(actor: Actor, id: string, scope: 'series' | 'occurrence', occurrenceKey?: string | null) {
  await db.transaction(async (tx) => {
    const current = await eventRow(tx, actor.orgId, id, true);
    const people = (await tx.select().from(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, id))).map((a) => a.userId);
    if (!canSee(current, people, actor.userId)) throw notFound('That event');
    if (!actor.canDeleteAny && current.createdBy !== actor.userId && !people.includes(actor.userId)) throw forbidden('Only the organizer, attendees or an admin can delete this event.');
    if (scope === 'occurrence' && current.recurrence && occurrenceKey) {
      await tx
        .insert(schema.eventExceptions)
        .values({ eventId: id, occurrenceKey, cancelled: true })
        .onConflictDoUpdate({ target: [schema.eventExceptions.eventId, schema.eventExceptions.occurrenceKey], set: { cancelled: true, updatedAt: new Date() } });
      await tx.update(E).set({ version: current.version + 1, updatedAt: new Date() }).where(eq(E.id, id));
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'cancelled', entityType: 'event', entityId: id, summary: `cancelled one “${current.title}” occurrence` });
    } else {
      await tx.update(E).set({ deletedAt: new Date(), version: current.version + 1 }).where(eq(E.id, id));
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'event', entityId: id, summary: `deleted “${current.title}”${current.recurrence ? ' (series)' : ''}` });
    }
  });
  publish(actor.orgId, { topics: ['events', 'activity'], actorId: actor.userId });
}

export async function restoreEvent(actor: Actor, id: string, occurrenceKey?: string | null) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(E).where(and(eq(E.orgId, actor.orgId), eq(E.id, id)));
    if (!row) throw notFound('That event');
    if (occurrenceKey) {
      await tx.delete(schema.eventExceptions).where(and(eq(schema.eventExceptions.eventId, id), eq(schema.eventExceptions.occurrenceKey, occurrenceKey), eq(schema.eventExceptions.cancelled, true)));
    } else {
      await tx.update(E).set({ deletedAt: null }).where(eq(E.id, id));
    }
    await tx.update(E).set({ version: row.version + 1 }).where(eq(E.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'restored', entityType: 'event', entityId: id, summary: `restored “${row.title}”` });
  });
  publish(actor.orgId, { topics: ['events', 'activity'], actorId: actor.userId });
}

export async function setResponse(actor: Actor, id: string, response: 'accepted' | 'declined') {
  await eventRow(db, actor.orgId, id);
  const res = await db
    .update(schema.eventAttendees)
    .set({ response })
    .where(and(eq(schema.eventAttendees.eventId, id), eq(schema.eventAttendees.userId, actor.userId)))
    .returning();
  if (res.length === 0) throw new ApiError(422, 'invalid', 'You’re not an attendee of this event.');
  publish(actor.orgId, { topics: ['events'], actorId: actor.userId });
}

export async function attendeeResponses(eventId: string) {
  return db.select({ userId: schema.eventAttendees.userId, response: schema.eventAttendees.response }).from(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, eventId));
}

export const eventHref = (o: Pick<EventOccurrence, 'eventId' | 'occurrenceKey' | 'startDate' | 'startsAt'>, tz: string) =>
  `/app/calendar?date=${o.startDate ?? dateInZone(new Date(o.startsAt!), tz)}&event=${encodeURIComponent(o.eventId)}${o.occurrenceKey ? `&occurrence=${encodeURIComponent(o.occurrenceKey)}` : ''}`;

