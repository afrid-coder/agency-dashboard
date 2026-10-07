// Proposed changes from Lume. A proposal is validated when it is made (so the
// preview is accurate and warns about conflicts or duplicates) and again when
// a person confirms it. Confirmation runs the normal task/event services with
// the confirming person's permissions and an idempotency key, so a double
// click or a retry can never create two records.
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { ApiError, notFound } from '../http.ts';
import { createTask, getTask, insertTask, notifyAssigned, updateTask, findSimilarOpenTask, type Actor } from '../services/tasks.ts';
import { createEvent, findConflicts, getEventForUser, eventHref, toStorage, type EventInput } from '../services/events.ts';
import { assertMembers } from '../services/members.ts';
import { publish } from '../realtime.ts';
import { log } from '../log.ts';
import { formatInstant, isHHMM, isISODate, zonedToUtc } from '../../shared/dates.ts';
import type { ActionPayload, ActionWarning, LumeAction, ProposedEvent, ProposedTask, RecordRef, Task } from '../../shared/types.ts';
import type { LumeCtx } from './tools.ts';

const dateStr = z.string().refine(isISODate, 'must be a real date in YYYY-MM-DD form');
const timeStr = z.string().refine(isHHMM, 'must be HH:MM');
const priority = z.enum(['low', 'medium', 'high']);

const taskIn = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  due_date: dateStr.nullable().optional(),
  due_time: timeStr.nullable().optional(),
  priority: priority.optional(),
  project_id: z.string().uuid().nullable().optional(),
  assignee_ids: z.array(z.string().max(64)).max(12).optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

const inputs = {
  propose_create_task: taskIn,
  propose_task_list: z.object({ project_id: z.string().uuid().nullable().optional(), tasks: z.array(taskIn.omit({ description: true, due_time: true, project_id: true })).min(1).max(12) }),
  propose_update_task: z.object({
    task_id: z.string().uuid(),
    status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
    due_date: dateStr.nullable().optional(),
    priority: priority.optional(),
    assignee_ids: z.array(z.string().max(64)).max(12).optional(),
  }),
  propose_create_event: z.object({
    title: z.string().trim().min(1).max(200),
    date: dateStr,
    start_time: timeStr.optional(),
    end_time: timeStr.optional(),
    all_day: z.boolean().optional(),
    end_date: dateStr.optional(),
    attendee_ids: z.array(z.string().max(64)).max(30).optional(),
    project_id: z.string().uuid().nullable().optional(),
    location: z.string().max(300).optional(),
    description: z.string().max(4000).optional(),
    visibility: z.enum(['team', 'private']).optional(),
  }),
};

const toTask = (t: z.infer<typeof taskIn>, projectId?: string | null): ProposedTask => ({
  title: t.title,
  description: t.description ?? '',
  dueDate: t.due_date ?? null,
  dueTime: t.due_date ? (t.due_time ?? null) : null,
  priority: t.priority ?? 'medium',
  projectId: projectId !== undefined ? projectId : (t.project_id ?? null),
  assigneeIds: [...new Set(t.assignee_ids ?? [])],
  checklist: t.checklist ?? [],
});

async function assertProjectId(orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.id, projectId)));
  if (!p) throw new ApiError(422, 'invalid', `No project with id ${projectId} exists. Use list_projects to find the right id, or ask the person.`);
}

async function checkMembers(orgId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  try {
    await assertMembers(db, orgId, ids);
  } catch {
    throw new ApiError(422, 'invalid', 'One of those member ids is not in this workspace. Call list_members to get valid ids, or ask who to include.');
  }
}

function eventInputFrom(e: ProposedEvent, key?: string): EventInput {
  return {
    title: e.title,
    description: e.description ?? '',
    location: e.location ?? '',
    allDay: e.allDay,
    date: e.date,
    endDate: e.allDay ? (e.endDate ?? e.date) : null,
    startTime: e.allDay ? null : e.startTime,
    endTime: e.allDay ? null : e.endTime,
    timezone: e.timezone,
    projectId: e.projectId ?? null,
    attendeeIds: e.attendeeIds ?? [],
    visibility: e.visibility ?? 'team',
    reminderMinutes: e.allDay ? null : 10,
    recurrence: null,
    idempotencyKey: key,
  };
}

/** Warnings shown on the preview card and returned to the model. */
export async function warningsFor(ctx: Pick<LumeCtx, 'orgId' | 'userId' | 'tz' | 'today' | 'memberNames'>, payload: ActionPayload): Promise<ActionWarning[]> {
  const w: ActionWarning[] = [];
  const pastDue = (d?: string | null) => d && d < ctx.today;
  if (payload.kind === 'create_task' || payload.kind === 'create_tasks') {
    const list = payload.kind === 'create_task' ? [payload.task] : payload.tasks;
    for (const t of list) {
      const similar = await findSimilarOpenTask(ctx.orgId, t.title, t.projectId);
      if (similar) w.push({ code: 'duplicate', message: `An open task called “${similar.title}” already exists.` });
      if (pastDue(t.dueDate)) w.push({ code: 'past_date', message: `“${t.title}” would be due in the past (${t.dueDate}).` });
    }
  } else if (payload.kind === 'update_task') {
    if (pastDue(payload.update.dueDate)) w.push({ code: 'past_date', message: `The new due date ${payload.update.dueDate} is in the past.` });
  } else if (payload.kind === 'create_event') {
    const e = payload.event;
    if (e.date < ctx.today) w.push({ code: 'past_date', message: 'This event is in the past.' });
    if (!e.allDay && e.startTime && e.endTime) {
      const s = zonedToUtc(e.date, e.startTime, e.timezone);
      const en = zonedToUtc(e.date, e.endTime, e.timezone);
      const people = [...new Set([ctx.userId, ...(e.attendeeIds ?? [])])];
      const conflicts = await findConflicts(ctx.orgId, ctx.userId, people, s, en, ctx.tz);
      for (const c of conflicts.slice(0, 3)) {
        const who = [...c.attendeeIds, c.createdBy].filter((id): id is string => Boolean(id) && people.includes(id!)).map((id) => ctx.memberNames.get(id)?.split(' ')[0] ?? 'someone');
        w.push({
          code: 'conflict',
          message: `Overlaps “${c.title}” (${formatInstant(c.startsAt!, ctx.tz, { hour: 'numeric', minute: '2-digit' })}–${formatInstant(c.endsAt!, ctx.tz, { hour: 'numeric', minute: '2-digit' })}) for ${[...new Set(who)].join(', ')}.`,
        });
      }
    }
  }
  return w;
}

async function payloadFromTool(ctx: LumeCtx, name: string, raw: unknown): Promise<ActionPayload> {
  switch (name) {
    case 'propose_create_task': {
      const i = inputs.propose_create_task.parse(raw);
      await assertProjectId(ctx.orgId, i.project_id);
      await checkMembers(ctx.orgId, i.assignee_ids);
      return { kind: 'create_task', task: toTask(i) };
    }
    case 'propose_task_list': {
      const i = inputs.propose_task_list.parse(raw);
      await assertProjectId(ctx.orgId, i.project_id);
      await checkMembers(ctx.orgId, i.tasks.flatMap((t) => t.assignee_ids ?? []));
      return { kind: 'create_tasks', projectId: i.project_id ?? null, tasks: i.tasks.map((t) => toTask(t, i.project_id ?? null)) };
    }
    case 'propose_update_task': {
      const i = inputs.propose_update_task.parse(raw);
      let task: Task;
      try {
        task = await getTask(ctx.orgId, i.task_id);
      } catch {
        throw new ApiError(422, 'invalid', `No task with id ${i.task_id}. Use list_tasks to find it.`);
      }
      await checkMembers(ctx.orgId, i.assignee_ids);
      if (i.status === undefined && i.due_date === undefined && i.priority === undefined && i.assignee_ids === undefined)
        throw new ApiError(422, 'invalid', 'Nothing to change. Include a status, due_date, priority or assignee_ids.');
      return {
        kind: 'update_task',
        update: {
          taskId: task.id,
          taskTitle: task.title,
          status: i.status,
          dueDate: i.due_date,
          priority: i.priority,
          assigneeIds: i.assignee_ids,
          base: { status: task.status, dueDate: task.dueDate, priority: task.priority, assigneeIds: task.assigneeIds },
        },
      };
    }
    case 'propose_create_event': {
      const i = inputs.propose_create_event.parse(raw);
      const allDay = i.all_day ?? (!i.start_time && !i.end_time);
      if (!allDay && (!i.start_time || !i.end_time))
        throw new ApiError(422, 'invalid', 'A timed event needs both start_time and end_time. Ask the person for the time (or duration) before proposing.');
      if (!allDay && i.end_time! <= i.start_time!) throw new ApiError(422, 'invalid', 'end_time must be after start_time.');
      await assertProjectId(ctx.orgId, i.project_id);
      await checkMembers(ctx.orgId, i.attendee_ids);
      return {
        kind: 'create_event',
        event: {
          title: i.title,
          description: i.description,
          location: i.location,
          allDay,
          date: i.date,
          startTime: allDay ? null : i.start_time,
          endTime: allDay ? null : i.end_time,
          endDate: allDay ? (i.end_date ?? i.date) : null,
          timezone: ctx.tz,
          attendeeIds: [...new Set(i.attendee_ids ?? [])],
          projectId: i.project_id ?? null,
          visibility: i.visibility ?? 'team',
        },
      };
    }
  }
  throw new ApiError(422, 'invalid', `Unknown proposal type ${name}.`);
}

const toAction = (row: typeof schema.lumeActions.$inferSelect): LumeAction => {
  const stored = row.payload as { payload: ActionPayload; warnings: ActionWarning[] };
  return {
    id: row.id,
    kind: row.kind as LumeAction['kind'],
    status: row.status as LumeAction['status'],
    payload: stored.payload,
    warnings: stored.warnings ?? [],
    result: (row.result as LumeAction['result']) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

export async function proposeAction(ctx: LumeCtx, toolName: string, raw: unknown): Promise<LumeAction> {
  const payload = await payloadFromTool(ctx, toolName, raw);
  const warnings = await warningsFor(ctx, payload);
  const [row] = await db
    .insert(schema.lumeActions)
    .values({ orgId: ctx.orgId, userId: ctx.userId, conversationId: ctx.conversationId, kind: payload.kind, payload: { payload, warnings } })
    .returning();
  return toAction(row);
}

export async function listActions(conversationId: string) {
  const rows = await db.select().from(schema.lumeActions).where(eq(schema.lumeActions.conversationId, conversationId));
  return rows.map(toAction);
}

// ─── Confirmation ────────────────────────────────────────────────────────

const editedTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).optional(),
  dueDate: dateStr.nullable().optional(),
  dueTime: timeStr.nullable().optional(),
  priority: priority.optional(),
  projectId: z.string().uuid().nullable().optional(),
  assigneeIds: z.array(z.string().max(64)).max(12).optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

const editedPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create_task'), task: editedTask }),
  z.object({ kind: z.literal('create_tasks'), projectId: z.string().uuid().nullable(), tasks: z.array(editedTask).min(1).max(12) }),
  z.object({
    kind: z.literal('update_task'),
    update: z.object({
      taskId: z.string().uuid(),
      taskTitle: z.string(),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
      dueDate: dateStr.nullable().optional(),
      priority: priority.optional(),
      assigneeIds: z.array(z.string()).optional(),
      base: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    kind: z.literal('create_event'),
    event: z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(8000).optional(),
      location: z.string().max(300).optional(),
      allDay: z.boolean(),
      date: dateStr,
      startTime: timeStr.nullable().optional(),
      endTime: timeStr.nullable().optional(),
      endDate: dateStr.nullable().optional(),
      timezone: z.string().min(1).max(64),
      attendeeIds: z.array(z.string()).max(30).optional(),
      projectId: z.string().uuid().nullable().optional(),
      visibility: z.enum(['team', 'private']).optional(),
    }),
  }),
]);

export async function confirmAction(actor: Actor, userTz: string, id: string, edited: unknown | undefined, force: boolean): Promise<LumeAction> {
  const [row] = await db.select().from(schema.lumeActions).where(and(eq(schema.lumeActions.id, id), eq(schema.lumeActions.orgId, actor.orgId), eq(schema.lumeActions.userId, actor.userId)));
  if (!row) throw notFound('That proposal');
  if (row.status === 'confirmed') return toAction(row); // already saved: idempotent
  if (row.status === 'cancelled') throw new ApiError(409, 'cancelled', 'This proposal was cancelled. Ask Lume again if you still want it.');

  const stored = row.payload as { payload: ActionPayload; warnings: ActionWarning[] };
  let payload = stored.payload;
  if (edited !== undefined) {
    const parsed = editedPayload.safeParse(edited);
    if (!parsed.success || parsed.data.kind !== row.kind) throw new ApiError(422, 'invalid', 'The edited proposal isn’t valid. Check the fields and try again.');
    payload = parsed.data as ActionPayload;
  }

  // Claim the proposal so two confirmations can't both run.
  const claimed = await db
    .update(schema.lumeActions)
    .set({ status: 'confirmed', resolvedAt: new Date(), payload: { payload, warnings: stored.warnings } })
    .where(and(eq(schema.lumeActions.id, id), inArray(schema.lumeActions.status, ['proposed', 'failed'])))
    .returning({ id: schema.lumeActions.id });
  if (claimed.length === 0) {
    const [again] = await db.select().from(schema.lumeActions).where(eq(schema.lumeActions.id, id));
    return toAction(again);
  }

  try {
    const refs: RecordRef[] = [];
    let message = '';
    const key = (suffix = '') => `lume:${id}${suffix}`;
    if (payload.kind === 'create_task') {
      const t = payload.task;
      const { task } = await createTask(actor, { title: t.title, description: t.description, dueDate: t.dueDate ?? null, dueTime: t.dueTime ?? null, priority: t.priority, projectId: t.projectId ?? null, assigneeIds: t.assigneeIds, checklist: t.checklist, idempotencyKey: key() }, 'lume');
      refs.push({ type: 'task', id: task.id, title: task.title, href: `/app/tasks?task=${task.id}` });
      message = 'Task created.';
    } else if (payload.kind === 'create_tasks') {
      const created = await db.transaction(async (tx) => {
        const out: { id: string; title: string; assignees: string[] }[] = [];
        for (const [i, t] of payload.tasks.entries()) {
          const r = await insertTask(tx, actor, { title: t.title, description: t.description, dueDate: t.dueDate ?? null, priority: t.priority, projectId: payload.projectId ?? t.projectId ?? null, assigneeIds: t.assigneeIds, checklist: t.checklist, idempotencyKey: key(`:${i}`) }, 'lume');
          out.push({ id: r.id, title: t.title, assignees: r.assignees });
        }
        return out;
      });
      publish(actor.orgId, { topics: ['tasks', 'projects', 'activity'], actorId: actor.userId });
      for (const c of created) {
        refs.push({ type: 'task', id: c.id, title: c.title, href: `/app/tasks?task=${c.id}` });
        if (c.assignees.length) await notifyAssigned(actor, c.id, c.title, c.assignees);
      }
      message = `${created.length} tasks created.`;
    } else if (payload.kind === 'update_task') {
      const u = payload.update;
      const changes: Record<string, unknown> = {};
      if (u.status !== undefined) changes.status = u.status;
      if (u.dueDate !== undefined) changes.dueDate = u.dueDate;
      if (u.priority !== undefined) changes.priority = u.priority;
      if (u.assigneeIds !== undefined) changes.assigneeIds = u.assigneeIds;
      const task = await updateTask(actor, u.taskId, changes, u.base as Record<string, unknown>, force);
      refs.push({ type: 'task', id: task.id, title: task.title, href: `/app/tasks?task=${task.id}` });
      message = u.status === 'done' ? 'Task marked complete.' : 'Task updated.';
    } else {
      const input = eventInputFrom(payload.event, key());
      toStorage(input); // validates times before writing
      const { eventId } = await createEvent(actor, input, 'lume');
      const { row: ev } = await getEventForUser(actor.orgId, actor.userId, eventId);
      refs.push({
        type: 'event',
        id: eventId,
        title: ev.title,
        href: eventHref({ eventId, occurrenceKey: null, startDate: ev.startDate, startsAt: ev.startsAt?.toISOString() ?? null }, userTz),
      });
      message = 'Event added to the calendar.';
    }
    const result = { refs, message };
    await db.update(schema.lumeActions).set({ result }).where(eq(schema.lumeActions.id, id));
    if (row.conversationId) {
      await db.insert(schema.lumeMessages).values({
        conversationId: row.conversationId,
        role: 'assistant',
        text: `${message} ${refs.map((r) => `[[${r.type}:${r.id}]]`).join(' ')}`,
        meta: { refs, sources: [], retrievedAt: null, actionIds: [], confirmation: true },
      });
      await db.update(schema.lumeConversations).set({ updatedAt: new Date() }).where(eq(schema.lumeConversations.id, row.conversationId));
    }
    const [done] = await db.select().from(schema.lumeActions).where(eq(schema.lumeActions.id, id));
    return toAction(done);
  } catch (err) {
    // Nothing was saved: return the proposal to a confirmable state and report why.
    await db.update(schema.lumeActions).set({ status: 'failed', resolvedAt: null }).where(eq(schema.lumeActions.id, id));
    if (!(err instanceof ApiError)) log.error('lume.confirm_failed', { message: (err as Error).message });
    throw err;
  }
}

export async function cancelAction(actor: Actor, id: string): Promise<LumeAction> {
  const [row] = await db
    .update(schema.lumeActions)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(and(eq(schema.lumeActions.id, id), eq(schema.lumeActions.orgId, actor.orgId), eq(schema.lumeActions.userId, actor.userId), inArray(schema.lumeActions.status, ['proposed', 'failed'])))
    .returning();
  if (!row) {
    const [existing] = await db.select().from(schema.lumeActions).where(and(eq(schema.lumeActions.id, id), eq(schema.lumeActions.userId, actor.userId)));
    if (!existing) throw notFound('That proposal');
    return toAction(existing);
  }
  return toAction(row);
}
