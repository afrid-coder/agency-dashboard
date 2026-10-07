// Clients and projects. Projects group tasks, events and profit entries and
// move through the agency's stages from discovery to ongoing marketing.
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db, isUniqueViolation, schema } from '../db/client.ts';
import { ApiError, notFound } from '../http.ts';
import { logActivity } from './activity.ts';
import { assertMembers } from './members.ts';
import { insertTask, notifyAssigned, type Actor, type TaskInput } from './tasks.ts';
import { publish } from '../realtime.ts';
import { addDays, todayIn } from '../../shared/dates.ts';
import { STAGE_TEMPLATES, STAGES, type Stage } from '../../shared/templates.ts';
import type { Client, ClientStatus, Project, ProjectStatus, TaskConflict } from '../../shared/types.ts';

const P = schema.projects;
const C = schema.clients;

// ─── Clients ─────────────────────────────────────────────────────────────

export async function listClients(orgId: string, includeArchived = false): Promise<Client[]> {
  const conds = [eq(C.orgId, orgId)];
  if (!includeArchived) conds.push(isNull(C.archivedAt));
  const rows = await db.select().from(C).where(and(...conds)).orderBy(asc(sql`lower(${C.name})`));
  const counts = rows.length
    ? await db
        .select({ clientId: P.clientId, n: count() })
        .from(P)
        .where(and(eq(P.orgId, orgId), inArray(P.clientId, rows.map((r) => r.id))))
        .groupBy(P.clientId)
    : [];
  const byClient = new Map(counts.map((c) => [c.clientId, Number(c.n)]));
  return rows.map((r) => toClient(r, byClient.get(r.id) ?? 0));
}

const toClient = (r: typeof C.$inferSelect, projectCount: number): Client => ({
  id: r.id,
  name: r.name,
  contactName: r.contactName,
  contactEmail: r.contactEmail,
  website: r.website,
  notes: r.notes,
  status: r.status as ClientStatus,
  archived: r.archivedAt !== null,
  projectCount,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const duplicateClient = () => new ApiError(409, 'duplicate', 'A client with that name already exists.', { fields: { name: 'A client with that name already exists.' } });

export interface ClientInput {
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  notes?: string | null;
  status?: ClientStatus;
}

export async function createClient(actor: Actor, input: ClientInput): Promise<Client> {
  try {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(C)
        .values({ orgId: actor.orgId, name: input.name, contactName: input.contactName ?? null, contactEmail: input.contactEmail ?? null, website: input.website ?? null, notes: input.notes ?? null, status: input.status ?? 'active', createdBy: actor.userId })
        .returning();
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'created', entityType: 'client', entityId: r.id, summary: `added client ${input.name}` });
      return r;
    });
    publish(actor.orgId, { topics: ['clients', 'activity'], actorId: actor.userId });
    return toClient(row, 0);
  } catch (err) {
    if (isUniqueViolation(err, 'client_org_name_uq')) throw duplicateClient();
    throw err;
  }
}

export async function updateClient(actor: Actor, id: string, patch: Partial<ClientInput> & { archived?: boolean }): Promise<Client> {
  const set: Partial<typeof C.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['name', 'contactName', 'contactEmail', 'website', 'notes', 'status'] as const) if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  try {
    const [row] = await db.update(C).set(set).where(and(eq(C.orgId, actor.orgId), eq(C.id, id))).returning();
    if (!row) throw notFound('That client');
    await logActivity(db, { orgId: actor.orgId, actorId: actor.userId, verb: patch.archived ? 'archived' : 'updated', entityType: 'client', entityId: id, summary: `${patch.archived ? 'archived' : 'updated'} client ${row.name}` });
    publish(actor.orgId, { topics: ['clients', 'projects', 'activity'], actorId: actor.userId });
    const [{ n }] = await db.select({ n: count() }).from(P).where(eq(P.clientId, id));
    return toClient(row, Number(n));
  } catch (err) {
    if (isUniqueViolation(err, 'client_org_name_uq')) throw duplicateClient();
    throw err;
  }
}

export async function deleteClient(actor: Actor, id: string) {
  const [row] = await db.select().from(C).where(and(eq(C.orgId, actor.orgId), eq(C.id, id)));
  if (!row) throw notFound('That client');
  const [{ n }] = await db.select({ n: count() }).from(P).where(eq(P.clientId, id));
  if (Number(n) > 0) throw new ApiError(409, 'in_use', `${row.name} has ${n} project${Number(n) === 1 ? '' : 's'}. Archive the client instead so their history stays intact.`);
  await db.transaction(async (tx) => {
    await tx.delete(C).where(eq(C.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'client', entityId: id, summary: `deleted client ${row.name}` });
  });
  publish(actor.orgId, { topics: ['clients', 'activity'], actorId: actor.userId });
}

// ─── Projects ────────────────────────────────────────────────────────────

export async function listProjects(orgId: string, tz: string, opts: { status?: string; clientId?: string; ids?: string[] } = {}): Promise<Project[]> {
  const conds = [eq(P.orgId, orgId)];
  const statuses = opts.status?.split(',').filter(Boolean);
  if (statuses?.length) conds.push(inArray(P.status, statuses));
  if (opts.clientId) conds.push(eq(P.clientId, opts.clientId));
  if (opts.ids) conds.push(inArray(P.id, opts.ids.length ? opts.ids : ['00000000-0000-0000-0000-000000000000']));
  const rows = await db
    .select({ p: P, clientName: C.name })
    .from(P)
    .leftJoin(C, eq(C.id, P.clientId))
    .where(and(...conds))
    .orderBy(sql`case ${P.status} when 'active' then 0 when 'planned' then 1 when 'on_hold' then 2 when 'completed' then 3 else 4 end`, sql`${P.dueDate} asc nulls last`, desc(P.updatedAt));
  if (rows.length === 0) return [];
  const today = todayIn(tz);
  const stats = await db
    .select({
      projectId: schema.tasks.projectId,
      total: count(),
      done: sql<number>`count(*) filter (where ${schema.tasks.status} = 'done')`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${schema.tasks.status} <> 'done' and ${schema.tasks.dueDate} < ${today})`.mapWith(Number),
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.orgId, orgId), isNull(schema.tasks.deletedAt), inArray(schema.tasks.projectId, rows.map((r) => r.p.id))))
    .groupBy(schema.tasks.projectId);
  const byProject = new Map(stats.map((s) => [s.projectId, { total: Number(s.total), done: s.done, overdue: s.overdue }]));
  return rows.map(({ p, clientName }) => toProject(p, clientName, byProject.get(p.id) ?? { total: 0, done: 0, overdue: 0 }));
}

const toProject = (p: typeof P.$inferSelect, clientName: string | null, taskCounts: Project['taskCounts']): Project => ({
  id: p.id,
  name: p.name,
  description: p.description,
  clientId: p.clientId,
  clientName,
  stage: p.stage as Stage,
  status: p.status as ProjectStatus,
  leadId: p.leadId,
  startDate: p.startDate,
  dueDate: p.dueDate,
  color: p.color,
  taskCounts,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export async function getProject(orgId: string, tz: string, id: string): Promise<Project> {
  const [p] = await listProjects(orgId, tz, { ids: [id] });
  if (!p) throw notFound('That project');
  return p;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  clientId?: string | null;
  stage: Stage;
  status: ProjectStatus;
  leadId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  color: string;
  templates: Stage[];
  newClientName?: string;
  idempotencyKey?: string;
}

async function assertClient(orgId: string, clientId: string | null | undefined, q = db) {
  if (!clientId) return;
  const [c] = await q.select({ id: C.id }).from(C).where(and(eq(C.orgId, orgId), eq(C.id, clientId)));
  if (!c) throw new ApiError(422, 'invalid', 'That client isn’t in this workspace.', { fields: { clientId: 'Choose a client from this workspace.' } });
}

export async function createProject(actor: Actor, tz: string, input: ProjectInput): Promise<{ project: Project; tasksCreated: number }> {
  if (input.idempotencyKey) {
    const [existing] = await db.select({ id: P.id }).from(P).where(and(eq(P.orgId, actor.orgId), eq(P.idempotencyKey, input.idempotencyKey)));
    if (existing) return { project: await getProject(actor.orgId, tz, existing.id), tasksCreated: 0 };
  }
  const result = await db
    .transaction(async (tx) => {
      let clientId = input.clientId ?? null;
      if (input.newClientName) {
        const [c] = await tx.insert(C).values({ orgId: actor.orgId, name: input.newClientName, createdBy: actor.userId }).returning({ id: C.id });
        clientId = c.id;
        await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'created', entityType: 'client', entityId: c.id, summary: `added client ${input.newClientName}` });
      } else await assertClient(actor.orgId, clientId, tx as never);
      if (input.leadId) await assertMembers(tx, actor.orgId, [input.leadId], 'leadId');
      const [p] = await tx
        .insert(P)
        .values({
          orgId: actor.orgId,
          name: input.name,
          description: input.description ?? null,
          clientId,
          stage: input.stage,
          status: input.status,
          leadId: input.leadId ?? null,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          color: input.color,
          idempotencyKey: input.idempotencyKey ?? null,
          createdBy: actor.userId,
        })
        .returning({ id: P.id });
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'created', entityType: 'project', entityId: p.id, summary: `created project ${input.name}` });
      let tasksCreated = 0;
      const assigned: { id: string; title: string; users: string[] }[] = [];
      const ordered = STAGES.map((s) => s.value).filter((s) => input.templates.includes(s));
      for (const stage of ordered) {
        for (const t of STAGE_TEMPLATES[stage]) {
          const task: TaskInput = {
            title: t.title,
            priority: t.priority,
            projectId: p.id,
            dueDate: input.startDate ? addDays(input.startDate, t.offsetDays) : null,
            assigneeIds: input.leadId ? [input.leadId] : [],
            checklist: t.checklist,
          };
          const created = await insertTask(tx, actor, task, 'template');
          assigned.push({ id: created.id, title: t.title, users: created.assignees });
          tasksCreated++;
        }
      }
      return { id: p.id, tasksCreated, assigned };
    })
    .catch((err) => {
      if (isUniqueViolation(err, 'client_org_name_uq')) throw duplicateClient();
      throw err;
    });
  publish(actor.orgId, { topics: ['projects', 'clients', 'tasks', 'activity'], actorId: actor.userId });
  if (result.assigned.length && input.leadId && input.leadId !== actor.userId)
    await notifyAssigned(actor, result.assigned[0].id, `${result.tasksCreated} starter tasks for ${input.name}`, [input.leadId]);
  return { project: await getProject(actor.orgId, tz, result.id), tasksCreated: result.tasksCreated };
}

type ProjectChanges = Partial<Omit<ProjectInput, 'templates' | 'newClientName' | 'idempotencyKey'>>;

export async function updateProject(actor: Actor, tz: string, id: string, changes: ProjectChanges, base: Record<string, unknown>): Promise<Project> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(P).where(and(eq(P.orgId, actor.orgId), eq(P.id, id))).for('update');
    if (!current) throw notFound('That project');
    const conflicts: TaskConflict[] = [];
    for (const [f, v] of Object.entries(changes)) {
      if (!(f in base)) continue;
      const theirs = (current as Record<string, unknown>)[f] ?? null;
      if (theirs !== (base[f] ?? null) && theirs !== (v ?? null)) conflicts.push({ field: f, yours: v, theirs });
    }
    if (conflicts.length) throw new ApiError(409, 'conflict', 'A teammate changed this project while you were editing.', { details: { conflicts } });
    if (changes.clientId !== undefined) await assertClient(actor.orgId, changes.clientId, tx as never);
    if (changes.leadId) await assertMembers(tx, actor.orgId, [changes.leadId], 'leadId');
    const start = changes.startDate !== undefined ? changes.startDate : current.startDate;
    const due = changes.dueDate !== undefined ? changes.dueDate : current.dueDate;
    if (start && due && due < start) throw new ApiError(422, 'invalid', 'The due date must be on or after the start date.', { fields: { dueDate: 'Must be on or after the start date.' } });
    await tx
      .update(P)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(P.id, id));
    const summary =
      changes.stage && changes.stage !== current.stage
        ? `moved ${current.name} to ${STAGES.find((s) => s.value === changes.stage)?.label}`
        : changes.status && changes.status !== current.status
          ? `marked ${current.name} ${changes.status.replace('_', ' ')}`
          : `updated project ${changes.name ?? current.name}`;
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'updated', entityType: 'project', entityId: id, summary });
  });
  publish(actor.orgId, { topics: ['projects', 'activity', 'tasks'], actorId: actor.userId });
  return getProject(actor.orgId, tz, id);
}

export async function deleteProject(actor: Actor, id: string) {
  const [row] = await db.select().from(P).where(and(eq(P.orgId, actor.orgId), eq(P.id, id)));
  if (!row) throw notFound('That project');
  await db.transaction(async (tx) => {
    await tx.delete(P).where(eq(P.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'project', entityId: id, summary: `deleted project ${row.name}` });
  });
  publish(actor.orgId, { topics: ['projects', 'tasks', 'events', 'profit', 'activity'], actorId: actor.userId });
}

/** Active projects with deadlines in [from, to]. */
export async function projectDeadlines(orgId: string, from: string, to: string) {
  return db
    .select({ id: P.id, name: P.name, dueDate: P.dueDate })
    .from(P)
    .where(and(eq(P.orgId, orgId), ne(P.status, 'archived'), ne(P.status, 'completed'), sql`${P.dueDate} between ${from} and ${to}`))
    .orderBy(asc(P.dueDate));
}

export async function overdueProjects(orgId: string, today: string) {
  return db
    .select({ id: P.id, name: P.name, dueDate: P.dueDate })
    .from(P)
    .where(and(eq(P.orgId, orgId), inArray(P.status, ['active', 'planned']), lt(P.dueDate, today)));
}
