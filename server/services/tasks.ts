// Tasks: assignees, checklist (subtasks), comments, field-level conflict
// detection for shared editing, soft delete with undo.
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { db, isUniqueViolation, schema, type Queryable } from '../db/client.ts';
import { ApiError, forbidden, notFound } from '../http.ts';
import { assertMembers, memberNames } from './members.ts';
import { logActivity, listActivity } from './activity.ts';
import { notify } from './notifications.ts';
import { publish } from '../realtime.ts';
import { addDays, formatISO, todayIn } from '../../shared/dates.ts';
import type { Page, Priority, Task, TaskConflict, TaskDetail, TaskStatus, TaskView } from '../../shared/types.ts';
import { CHECKLIST_TEMPLATES } from '../../shared/templates.ts';

const T = schema.tasks;

export interface Actor {
  orgId: string;
  userId: string;
  userName: string;
  canDeleteAny: boolean;
}

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  assigneeIds?: string[];
  checklist?: string[];
  idempotencyKey?: string;
}

class ConflictSignal extends Error {
  conflicts: TaskConflict[];
  constructor(conflicts: TaskConflict[]) {
    super('conflict');
    this.conflicts = conflicts;
  }
}

const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Completed' };
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

async function hydrate(rows: (typeof T.$inferSelect & { projectName: string | null })[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [assignees, checklist, comments] = await Promise.all([
    db.select({ taskId: schema.taskAssignees.taskId, userId: schema.taskAssignees.userId }).from(schema.taskAssignees).where(inArray(schema.taskAssignees.taskId, ids)),
    db
      .select({ taskId: schema.taskChecklistItems.taskId, total: count(), done: sql<number>`count(*) filter (where ${schema.taskChecklistItems.done})`.mapWith(Number) })
      .from(schema.taskChecklistItems)
      .where(inArray(schema.taskChecklistItems.taskId, ids))
      .groupBy(schema.taskChecklistItems.taskId),
    db.select({ taskId: schema.taskComments.taskId, n: count() }).from(schema.taskComments).where(inArray(schema.taskComments.taskId, ids)).groupBy(schema.taskComments.taskId),
  ]);
  const byTask = new Map<string, string[]>();
  for (const a of assignees) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a.userId]);
  const cl = new Map(checklist.map((c) => [c.taskId, { total: Number(c.total), done: Number(c.done) }]));
  const cm = new Map(comments.map((c) => [c.taskId, Number(c.n)]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status as TaskStatus,
    priority: r.priority as Priority,
    dueDate: r.dueDate,
    dueTime: hhmm(r.dueTime),
    projectId: r.projectId,
    projectName: r.projectName,
    assigneeIds: (byTask.get(r.id) ?? []).sort(),
    checklist: cl.get(r.id) ?? { total: 0, done: 0 },
    commentCount: cm.get(r.id) ?? 0,
    completedAt: r.completedAt?.toISOString() ?? null,
    completedBy: r.completedBy,
    createdBy: r.createdBy,
    source: r.source as Task['source'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

function baseSelect() {
  return db
    .select({ ...getColumns(), projectName: schema.projects.name })
    .from(T)
    .leftJoin(schema.projects, eq(schema.projects.id, T.projectId));
}

function getColumns() {
  const { id, orgId, projectId, title, description, status, priority, dueDate, dueTime, completedAt, completedBy, source, idempotencyKey, createdBy, createdAt, updatedAt, deletedAt } = T;
  return { id, orgId, projectId, title, description, status, priority, dueDate, dueTime, completedAt, completedBy, source, idempotencyKey, createdBy, createdAt, updatedAt, deletedAt };
}

const assignedTo = (userId: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(schema.taskAssignees)
      .where(and(eq(schema.taskAssignees.taskId, T.id), eq(schema.taskAssignees.userId, userId))),
  );

export interface TaskQuery {
  view: TaskView;
  projectId?: string;
  assigneeId?: string;
  status?: string;
  priority?: string;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

export async function listTasks(orgId: string, userId: string, tz: string, query: TaskQuery): Promise<Page<Task>> {
  const today = todayIn(tz);
  const conds: SQL[] = [eq(T.orgId, orgId), isNull(T.deletedAt)];
  const statuses = query.status?.split(',').filter((s): s is TaskStatus => ['todo', 'in_progress', 'review', 'done'].includes(s)) ?? [];
  const priorities = query.priority?.split(',').filter((s): s is Priority => ['low', 'medium', 'high'].includes(s)) ?? [];

  if (statuses.length) conds.push(inArray(T.status, statuses));
  else if (query.view !== 'completed') conds.push(ne(T.status, 'done'));

  switch (query.view) {
    case 'mine':
      conds.push(assignedTo(userId));
      break;
    case 'overdue':
      conds.push(lt(T.dueDate, today), ne(T.status, 'done'));
      break;
    case 'upcoming':
      conds.push(gte(T.dueDate, today), lte(T.dueDate, addDays(today, 14)));
      break;
    case 'completed':
      conds.push(eq(T.status, 'done'));
      break;
  }
  if (priorities.length) conds.push(inArray(T.priority, priorities));
  if (query.projectId) conds.push(eq(T.projectId, query.projectId));
  if (query.assigneeId === 'unassigned') conds.push(sql`not exists (select 1 from task_assignees ta where ta.task_id = ${T.id})`);
  else if (query.assigneeId) conds.push(assignedTo(query.assigneeId));
  if (query.q) conds.push(ilike(T.title, `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  if (query.from) conds.push(gte(T.dueDate, query.from));
  if (query.to) conds.push(lte(T.dueDate, query.to));

  const offset = Math.max(Number(query.cursor ?? 0) || 0, 0);
  const order =
    query.view === 'completed'
      ? [desc(T.completedAt)]
      : [sql`${T.dueDate} asc nulls last`, sql`case ${T.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, asc(T.createdAt)];
  const rows = await baseSelect()
    .where(and(...conds))
    .orderBy(...order)
    .limit(query.limit + 1)
    .offset(offset);
  const items = await hydrate(rows.slice(0, query.limit));
  return { items, nextCursor: rows.length > query.limit ? String(offset + query.limit) : null };
}

async function taskRow(q: Queryable, orgId: string, id: string, lock = false) {
  const base = q.select().from(T).where(and(eq(T.orgId, orgId), eq(T.id, id), isNull(T.deletedAt)));
  const [row] = lock ? await base.for('update') : await base;
  if (!row) throw notFound('That task');
  return row;
}

export async function getTask(orgId: string, id: string): Promise<Task> {
  const [row] = await baseSelect().where(and(eq(T.orgId, orgId), eq(T.id, id), isNull(T.deletedAt)));
  if (!row) throw notFound('That task');
  return (await hydrate([row]))[0];
}

export async function getTaskDetail(orgId: string, id: string): Promise<TaskDetail> {
  const task = await getTask(orgId, id);
  const [items, comments, history] = await Promise.all([
    db.select().from(schema.taskChecklistItems).where(eq(schema.taskChecklistItems.taskId, id)).orderBy(asc(schema.taskChecklistItems.position), asc(schema.taskChecklistItems.createdAt)),
    db.select().from(schema.taskComments).where(eq(schema.taskComments.taskId, id)).orderBy(asc(schema.taskComments.createdAt)).limit(200),
    listActivity(orgId, { includeRestricted: false, entity: { type: 'task', id }, limit: 20 }),
  ]);
  return {
    ...task,
    items: items.map((i) => ({ id: i.id, title: i.title, done: i.done, position: i.position })),
    comments: comments.map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, createdAt: c.createdAt.toISOString(), editedAt: c.editedAt?.toISOString() ?? null })),
    history: history.items,
  };
}

export async function assertProject(q: Queryable, orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await q.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.id, projectId)));
  if (!p) throw new ApiError(422, 'invalid', 'That project isn’t in this workspace.', { fields: { projectId: 'Choose a project from this workspace.' } });
}

/** Creates a task inside an existing transaction. Returns the id; notifications are the caller's job after commit. */
export async function insertTask(tx: Queryable, actor: Actor, input: TaskInput, source: Task['source'] = 'manual') {
  await assertProject(tx, actor.orgId, input.projectId);
  const assignees = await assertMembers(tx, actor.orgId, input.assigneeIds ?? []);
  const status = input.status ?? 'todo';
  const [row] = await tx
    .insert(T)
    .values({
      orgId: actor.orgId,
      title: input.title,
      description: input.description ?? '',
      status,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null,
      dueTime: input.dueDate ? (input.dueTime ?? null) : null,
      projectId: input.projectId ?? null,
      source,
      idempotencyKey: input.idempotencyKey ?? null,
      completedAt: status === 'done' ? new Date() : null,
      completedBy: status === 'done' ? actor.userId : null,
      createdBy: actor.userId,
    })
    .returning({ id: T.id });
  if (assignees.length) await tx.insert(schema.taskAssignees).values(assignees.map((userId) => ({ taskId: row.id, userId, assignedBy: actor.userId })));
  const items = (input.checklist ?? []).filter((t) => t.trim());
  if (items.length) await tx.insert(schema.taskChecklistItems).values(items.map((title, i) => ({ taskId: row.id, title: title.trim().slice(0, 200), position: i })));
  await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'created', entityType: 'task', entityId: row.id, summary: `created “${input.title}”` });
  return { id: row.id, assignees };
}

export async function notifyAssigned(actor: Actor, taskId: string, title: string, userIds: string[]) {
  await notify({
    orgId: actor.orgId,
    userIds,
    actorId: actor.userId,
    kind: 'task_assigned',
    pref: 'taskAssigned',
    title: `${actor.userName} assigned you “${title}”`,
    link: `/app/tasks?task=${taskId}`,
    dedupeKey: `assigned:${taskId}:${Date.now()}`,
    email: { actorName: actor.userName, taskTitle: title },
  });
}

export async function createTask(actor: Actor, input: TaskInput, source: Task['source'] = 'manual'): Promise<{ task: Task; duplicate: boolean }> {
  if (input.idempotencyKey) {
    const [existing] = await db.select({ id: T.id }).from(T).where(and(eq(T.orgId, actor.orgId), eq(T.idempotencyKey, input.idempotencyKey)));
    if (existing) return { task: await getTask(actor.orgId, existing.id), duplicate: true };
  }
  let created: { id: string; assignees: string[] };
  try {
    created = await db.transaction((tx) => insertTask(tx, actor, input, source));
  } catch (err) {
    if (isUniqueViolation(err, 'task_idempotency_uq') && input.idempotencyKey) {
      const [existing] = await db.select({ id: T.id }).from(T).where(and(eq(T.orgId, actor.orgId), eq(T.idempotencyKey, input.idempotencyKey)));
      return { task: await getTask(actor.orgId, existing.id), duplicate: true };
    }
    throw err;
  }
  publish(actor.orgId, { topics: ['tasks', 'activity', 'projects'], actorId: actor.userId });
  await notifyAssigned(actor, created.id, input.title, created.assignees);
  return { task: await getTask(actor.orgId, created.id), duplicate: false };
}

type Editable = 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'dueTime' | 'projectId' | 'assigneeIds';
export type TaskChanges = Partial<{ title: string; description: string; status: TaskStatus; priority: Priority; dueDate: string | null; dueTime: string | null; projectId: string | null; assigneeIds: string[] }>;

const norm = (field: string, v: unknown) => {
  if (field === 'assigneeIds') return JSON.stringify([...((v as string[] | undefined) ?? [])].sort());
  if (field === 'dueTime') return (v as string | null)?.slice(0, 5) ?? null;
  return v ?? null;
};

function describeChange(title: string, changes: TaskChanges, names: Map<string, string>): { verb: string; summary: string } {
  if (changes.status === 'done') return { verb: 'completed', summary: `completed “${title}”` };
  if (changes.status && Object.keys(changes).length === 1) return { verb: 'moved', summary: `moved “${title}” to ${STATUS_LABEL[changes.status]}` };
  if (changes.dueDate !== undefined && Object.keys(changes).filter((k) => k !== 'dueTime').length === 1)
    return { verb: 'rescheduled', summary: changes.dueDate ? `rescheduled “${title}” to ${formatISO(changes.dueDate, { month: 'short', day: 'numeric' })}` : `cleared the due date on “${title}”` };
  if (changes.assigneeIds && Object.keys(changes).length === 1) {
    const who = changes.assigneeIds.map((id) => names.get(id)?.split(' ')[0] ?? 'someone');
    return { verb: 'assigned', summary: who.length ? `assigned “${title}” to ${who.join(', ')}` : `unassigned “${title}”` };
  }
  return { verb: 'updated', summary: `updated “${title}”` };
}

/**
 * Applies a partial update. `base` holds the values the editor started from:
 * if a teammate changed one of the same fields since then, nothing is saved
 * and the conflicting fields are returned so the person can choose.
 */
export async function updateTask(actor: Actor, id: string, changes: TaskChanges, base: Record<string, unknown>, force = false): Promise<Task> {
  const names = await memberNames(actor.orgId);
  const result = await db
    .transaction(async (tx) => {
    const current = await taskRow(tx, actor.orgId, id, true);
    const currentAssignees = (await tx.select({ userId: schema.taskAssignees.userId }).from(schema.taskAssignees).where(eq(schema.taskAssignees.taskId, id))).map((r) => r.userId);
    const snapshot: Record<Editable, unknown> = {
      title: current.title,
      description: current.description,
      status: current.status,
      priority: current.priority,
      dueDate: current.dueDate,
      dueTime: hhmm(current.dueTime),
      projectId: current.projectId,
      assigneeIds: currentAssignees,
    };
    const fields = Object.keys(changes) as Editable[];
    if (!force) {
      const conflicts: TaskConflict[] = [];
      for (const f of fields) {
        if (!(f in base)) continue;
        const theirs = norm(f, snapshot[f]);
        if (theirs !== norm(f, base[f]) && theirs !== norm(f, changes[f])) conflicts.push({ field: f, yours: changes[f], theirs: snapshot[f] });
      }
      if (conflicts.length) throw new ConflictSignal(conflicts);
    }
    if (changes.projectId !== undefined) await assertProject(tx, actor.orgId, changes.projectId);
    const set: Partial<typeof T.$inferInsert> = { updatedAt: new Date() };
    if (changes.title !== undefined) set.title = changes.title;
    if (changes.description !== undefined) set.description = changes.description;
    if (changes.priority !== undefined) set.priority = changes.priority;
    if (changes.projectId !== undefined) set.projectId = changes.projectId;
    if (changes.dueDate !== undefined) {
      set.dueDate = changes.dueDate;
      if (!changes.dueDate) set.dueTime = null;
    }
    if (changes.dueTime !== undefined) {
      const due = changes.dueDate !== undefined ? changes.dueDate : current.dueDate;
      if (changes.dueTime && !due) throw new ApiError(422, 'invalid', 'Pick a due date before adding a time.', { fields: { dueTime: 'Pick a due date first.' } });
      set.dueTime = changes.dueTime;
    }
    if (changes.status !== undefined && changes.status !== current.status) {
      set.status = changes.status;
      set.completedAt = changes.status === 'done' ? new Date() : null;
      set.completedBy = changes.status === 'done' ? actor.userId : null;
    }
    await tx.update(T).set(set).where(eq(T.id, id));

    let added: string[] = [];
    if (changes.assigneeIds) {
      const next = await assertMembers(tx, actor.orgId, changes.assigneeIds);
      added = next.filter((u) => !currentAssignees.includes(u));
      const removed = currentAssignees.filter((u) => !next.includes(u));
      if (removed.length) await tx.delete(schema.taskAssignees).where(and(eq(schema.taskAssignees.taskId, id), inArray(schema.taskAssignees.userId, removed)));
      if (added.length) await tx.insert(schema.taskAssignees).values(added.map((userId) => ({ taskId: id, userId, assignedBy: actor.userId })));
    }
    const title = changes.title ?? current.title;
    const d = describeChange(title, changes, names);
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: d.verb, entityType: 'task', entityId: id, summary: d.summary });
    return { added, title };
  })
    .catch(async (err) => {
      // Read the teammate's version only after the transaction has ended.
      if (err instanceof ConflictSignal)
        throw new ApiError(409, 'conflict', 'A teammate changed this task while you were editing. Review their change before saving yours.', {
          details: { conflicts: err.conflicts, task: await getTask(actor.orgId, id) },
        });
      throw err;
    });
  publish(actor.orgId, { topics: ['tasks', 'activity', 'projects'], actorId: actor.userId });
  if (result.added.length) await notifyAssigned(actor, id, result.title, result.added);
  return getTask(actor.orgId, id);
}

export async function deleteTask(actor: Actor, id: string) {
  const row = await taskRow(db, actor.orgId, id);
  if (!actor.canDeleteAny && row.createdBy !== actor.userId) throw forbidden('Only the person who created this task, or an admin, can delete it.');
  await db.transaction(async (tx) => {
    await tx.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(T.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'task', entityId: id, summary: `deleted “${row.title}”` });
  });
  publish(actor.orgId, { topics: ['tasks', 'activity', 'projects'], actorId: actor.userId });
}

export async function restoreTask(actor: Actor, id: string): Promise<Task> {
  const [row] = await db.select().from(T).where(and(eq(T.orgId, actor.orgId), eq(T.id, id), isNotNull(T.deletedAt)));
  if (!row) throw notFound('That deleted task');
  await db.transaction(async (tx) => {
    await tx.update(T).set({ deletedAt: null, updatedAt: new Date() }).where(eq(T.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'restored', entityType: 'task', entityId: id, summary: `restored “${row.title}”` });
  });
  publish(actor.orgId, { topics: ['tasks', 'activity', 'projects'], actorId: actor.userId });
  return getTask(actor.orgId, id);
}

// ─── Checklist ───────────────────────────────────────────────────────────

export async function addChecklistItems(actor: Actor, taskId: string, titles: string[]) {
  await taskRow(db, actor.orgId, taskId);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.taskChecklistItems.position}), -1)`.mapWith(Number) })
    .from(schema.taskChecklistItems)
    .where(eq(schema.taskChecklistItems.taskId, taskId));
  const existing = await db.select({ n: count() }).from(schema.taskChecklistItems).where(eq(schema.taskChecklistItems.taskId, taskId));
  if (Number(existing[0].n) + titles.length > 100) throw new ApiError(422, 'invalid', 'A checklist can hold up to 100 items.');
  const rows = await db
    .insert(schema.taskChecklistItems)
    .values(titles.map((title, i) => ({ taskId, title, position: max + 1 + i })))
    .returning();
  await db.update(T).set({ updatedAt: new Date() }).where(eq(T.id, taskId));
  publish(actor.orgId, { topics: ['tasks'], actorId: actor.userId });
  return rows.map((i) => ({ id: i.id, title: i.title, done: i.done, position: i.position }));
}

export async function applyChecklistTemplate(actor: Actor, taskId: string, templateId: string) {
  const template = CHECKLIST_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw notFound('That checklist template');
  return addChecklistItems(actor, taskId, template.items);
}

export async function updateChecklistItem(actor: Actor, taskId: string, itemId: string, patch: { title?: string; done?: boolean; position?: number }) {
  await taskRow(db, actor.orgId, taskId);
  const set: Partial<typeof schema.taskChecklistItems.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.done !== undefined) {
    set.done = patch.done;
    set.doneAt = patch.done ? new Date() : null;
    set.doneBy = patch.done ? actor.userId : null;
  }
  const [row] = await db
    .update(schema.taskChecklistItems)
    .set(set)
    .where(and(eq(schema.taskChecklistItems.id, itemId), eq(schema.taskChecklistItems.taskId, taskId)))
    .returning();
  if (!row) throw notFound('That checklist item');
  await db.update(T).set({ updatedAt: new Date() }).where(eq(T.id, taskId));
  publish(actor.orgId, { topics: ['tasks'], actorId: actor.userId });
  return { id: row.id, title: row.title, done: row.done, position: row.position };
}

export async function deleteChecklistItem(actor: Actor, taskId: string, itemId: string) {
  await taskRow(db, actor.orgId, taskId);
  await db.delete(schema.taskChecklistItems).where(and(eq(schema.taskChecklistItems.id, itemId), eq(schema.taskChecklistItems.taskId, taskId)));
  publish(actor.orgId, { topics: ['tasks'], actorId: actor.userId });
}

// ─── Comments ────────────────────────────────────────────────────────────

export async function addComment(actor: Actor, taskId: string, body: string) {
  const task = await taskRow(db, actor.orgId, taskId);
  const [row] = await db.insert(schema.taskComments).values({ taskId, authorId: actor.userId, body }).returning();
  await logActivity(db, { orgId: actor.orgId, actorId: actor.userId, verb: 'commented', entityType: 'task', entityId: taskId, summary: `commented on “${task.title}”` });
  publish(actor.orgId, { topics: ['tasks', 'activity'], actorId: actor.userId });
  const assignees = (await db.select({ userId: schema.taskAssignees.userId }).from(schema.taskAssignees).where(eq(schema.taskAssignees.taskId, taskId))).map((r) => r.userId);
  await notify({
    orgId: actor.orgId,
    userIds: [...assignees, ...(task.createdBy ? [task.createdBy] : [])],
    actorId: actor.userId,
    kind: 'task_comment',
    pref: 'taskComments',
    title: `${actor.userName} commented on “${task.title}”`,
    body: body.slice(0, 140),
    link: `/app/tasks?task=${taskId}`,
    dedupeKey: `comment:${row.id}`,
  });
  return { id: row.id, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString(), editedAt: null };
}

export async function editComment(actor: Actor, taskId: string, commentId: string, body: string) {
  await taskRow(db, actor.orgId, taskId);
  const [row] = await db
    .update(schema.taskComments)
    .set({ body, editedAt: new Date() })
    .where(and(eq(schema.taskComments.id, commentId), eq(schema.taskComments.taskId, taskId), eq(schema.taskComments.authorId, actor.userId)))
    .returning();
  if (!row) throw forbidden('You can only edit your own comments.');
  publish(actor.orgId, { topics: ['tasks'], actorId: actor.userId });
  return { id: row.id, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null };
}

export async function deleteComment(actor: Actor, taskId: string, commentId: string) {
  await taskRow(db, actor.orgId, taskId);
  const conds = [eq(schema.taskComments.id, commentId), eq(schema.taskComments.taskId, taskId)];
  if (!actor.canDeleteAny) conds.push(eq(schema.taskComments.authorId, actor.userId));
  const res = await db.delete(schema.taskComments).where(and(...conds)).returning({ id: schema.taskComments.id });
  if (res.length === 0) throw forbidden('You can only delete your own comments.');
  publish(actor.orgId, { topics: ['tasks'], actorId: actor.userId });
}

/** Open tasks similar to a proposed one (same title, not done) — used to warn about duplicates. */
export async function findSimilarOpenTask(orgId: string, title: string, projectId: string | null | undefined) {
  const conds = [eq(T.orgId, orgId), isNull(T.deletedAt), ne(T.status, 'done'), sql`lower(${T.title}) = lower(${title.trim()})`];
  if (projectId) conds.push(or(eq(T.projectId, projectId), isNull(T.projectId))!);
  const [row] = await db.select({ id: T.id, title: T.title, dueDate: T.dueDate }).from(T).where(and(...conds)).limit(1);
  return row ?? null;
}

/** Purge tasks deleted more than 30 days ago. */
export async function purgeDeletedTasks() {
  await db.delete(T).where(and(isNotNull(T.deletedAt), lt(T.deletedAt, new Date(Date.now() - 30 * 86_400_000))));
}
