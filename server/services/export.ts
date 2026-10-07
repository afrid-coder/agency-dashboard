// Authorized export of the workspace's core business records (owners and
// admins). JSON for a complete copy; CSV for spreadsheets.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { listMembers } from './members.ts';
import { logActivity } from './activity.ts';

export async function exportWorkspace(orgId: string, actorId: string) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [members, clients, projects, tasks, events, entries, goals, notes] = await Promise.all([
    listMembers(orgId),
    db.select().from(schema.clients).where(eq(schema.clients.orgId, orgId)).orderBy(asc(schema.clients.name)),
    db.select().from(schema.projects).where(eq(schema.projects.orgId, orgId)).orderBy(asc(schema.projects.createdAt)),
    db.select().from(schema.tasks).where(eq(schema.tasks.orgId, orgId)).orderBy(asc(schema.tasks.createdAt)),
    db.select().from(schema.events).where(eq(schema.events.orgId, orgId)).orderBy(asc(schema.events.createdAt)),
    db.select().from(schema.profitEntries).where(eq(schema.profitEntries.orgId, orgId)).orderBy(asc(schema.profitEntries.entryDate)),
    db.select().from(schema.profitGoals).where(eq(schema.profitGoals.orgId, orgId)).orderBy(asc(schema.profitGoals.month)),
    db.select().from(schema.notes).where(eq(schema.notes.orgId, orgId)).orderBy(asc(schema.notes.createdAt)),
  ]);
  const taskIds = tasks.map((t) => t.id);
  const eventIds = events.map((e) => e.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const [assignees, checklist, comments, attendees, exceptions] = await Promise.all([
    db.select().from(schema.taskAssignees).where(inArray(schema.taskAssignees.taskId, taskIds.length ? taskIds : none)),
    db.select().from(schema.taskChecklistItems).where(inArray(schema.taskChecklistItems.taskId, taskIds.length ? taskIds : none)),
    db.select().from(schema.taskComments).where(inArray(schema.taskComments.taskId, taskIds.length ? taskIds : none)),
    db.select().from(schema.eventAttendees).where(inArray(schema.eventAttendees.eventId, eventIds.length ? eventIds : none)),
    db.select().from(schema.eventExceptions).where(inArray(schema.eventExceptions.eventId, eventIds.length ? eventIds : none)),
  ]);
  await logActivity(db, { orgId, actorId, verb: 'exported', entityType: 'export', summary: 'exported workspace data', restricted: true });
  const strip = <T extends Record<string, unknown>>(r: T) => {
    const { idempotencyKey: _k, orgId: _o, ...rest } = r as Record<string, unknown>;
    return rest;
  };
  return {
    exportedAt: new Date().toISOString(),
    format: 'lumera-creative-export/1',
    workspace: { name: org.name, timezone: org.timezone, weekStartsOn: org.weekStartsOn, defaultTargetCents: org.defaultTargetCents, isDemo: org.isDemo },
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, jobTitle: m.jobTitle, joinedAt: m.joinedAt })),
    clients: clients.map(strip),
    projects: projects.map(strip),
    tasks: tasks.map((t) => ({
      ...strip(t),
      assigneeIds: assignees.filter((a) => a.taskId === t.id).map((a) => a.userId),
      checklist: checklist.filter((c) => c.taskId === t.id).map(({ taskId: _t, ...c }) => c),
      comments: comments.filter((c) => c.taskId === t.id).map(({ taskId: _t, ...c }) => c),
    })),
    events: events.map((e) => ({
      ...strip(e),
      attendees: attendees.filter((a) => a.eventId === e.id).map(({ eventId: _e, ...a }) => a),
      exceptions: exceptions.filter((x) => x.eventId === e.id).map(({ eventId: _e, ...x }) => x),
    })),
    profitEntries: entries.map(strip),
    profitGoals: goals.map(({ orgId: _o, ...g }) => g),
    notes: notes.map(strip),
  };
}

const csvCell = (v: unknown) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function profitCsv(orgId: string, actorId: string) {
  const rows = await db
    .select({ e: schema.profitEntries, client: schema.clients.name, project: schema.projects.name })
    .from(schema.profitEntries)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.profitEntries.clientId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.profitEntries.projectId))
    .where(and(eq(schema.profitEntries.orgId, orgId)))
    .orderBy(asc(schema.profitEntries.entryDate));
  await logActivity(db, { orgId, actorId, verb: 'exported', entityType: 'export', summary: 'exported profit entries (CSV)', restricted: true });
  return toCsv(
    ['date', 'profit_usd', 'client', 'project', 'note', 'deleted'],
    rows.map(({ e, client, project }) => [e.entryDate, (e.amountCents / 100).toFixed(2), client, project, e.note, e.deletedAt ? 'yes' : '']),
  );
}

export async function tasksCsv(orgId: string, actorId: string) {
  const members = new Map((await listMembers(orgId)).map((m) => [m.id, m.name]));
  const tasks = await db
    .select({ t: schema.tasks, project: schema.projects.name })
    .from(schema.tasks)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(eq(schema.tasks.orgId, orgId))
    .orderBy(asc(schema.tasks.createdAt));
  const ids = tasks.map((t) => t.t.id);
  const assignees = ids.length ? await db.select().from(schema.taskAssignees).where(inArray(schema.taskAssignees.taskId, ids)) : [];
  await logActivity(db, { orgId, actorId, verb: 'exported', entityType: 'export', summary: 'exported tasks (CSV)', restricted: true });
  return toCsv(
    ['title', 'status', 'priority', 'due_date', 'due_time', 'project', 'assignees', 'completed_at', 'created_at', 'deleted'],
    tasks.map(({ t, project }) => [
      t.title,
      t.status,
      t.priority,
      t.dueDate,
      t.dueTime?.slice(0, 5),
      project,
      assignees.filter((a) => a.taskId === t.id).map((a) => members.get(a.userId) ?? 'Former member').join('; '),
      t.completedAt,
      t.createdAt,
      t.deletedAt ? 'yes' : '',
    ]),
  );
}
