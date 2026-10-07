// Lume's tools. Read tools return only records the signed-in person may see,
// through the same services the dashboard uses. "propose_*" tools never
// change data: they create a pending action that a person must confirm.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../http.ts';
import { listTasks, getTaskDetail, type Actor } from '../services/tasks.ts';
import { listOccurrences, eventHref } from '../services/events.ts';
import { listProjects, getProject, listClients } from '../services/projects.ts';
import { listEntries, monthSummary, history } from '../services/profit.ts';
import { listMembers } from '../services/members.ts';
import { listNotes } from '../services/notes.ts';
import { proposeAction } from './actions.ts';
import { can, type PermissionContext, type Role } from '../../shared/permissions.ts';
import { addDays, diffDays, formatInstant, formatISO, formatMonth, isISODate, monthKey } from '../../shared/dates.ts';
import { formatCents } from '../../shared/money.ts';
import type { EventOccurrence, LumeAction, RecordRef, Task } from '../../shared/types.ts';

export interface LumeCtx {
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  role: Role;
  perm: PermissionContext;
  tz: string;
  today: string;
  actor: Actor;
  conversationId: string | null;
  page: string;
  refs: Map<string, RecordRef>;
  sources: Set<string>;
  retrievedAt: Date | null;
  actions: LumeAction[];
  memberNames: Map<string, string>;
}

const token = (type: string, id: string) => `[[${type}:${id}]]`;

function remember(ctx: LumeCtx, ref: RecordRef) {
  ctx.refs.set(`${ref.type}:${ref.id}`, ref);
  return token(ref.type, ref.id);
}

function touched(ctx: LumeCtx, source: string) {
  ctx.sources.add(source);
  ctx.retrievedAt ??= new Date();
}

const dueLabel = (due: string | null, today: string) => {
  if (!due) return 'no due date';
  const d = diffDays(due, today);
  const day = formatISO(due, { weekday: 'short', month: 'short', day: 'numeric' });
  if (d === 0) return `${day} (today)`;
  if (d === 1) return `${day} (tomorrow)`;
  if (d < 0) return `${day} (overdue by ${-d} day${d === -1 ? '' : 's'})`;
  return day;
};

const STATUS: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Completed' };

export function taskForModel(ctx: LumeCtx, t: Task) {
  return {
    ref: remember(ctx, { type: 'task', id: t.id, title: t.title, href: `/app/tasks?task=${t.id}`, subtitle: t.dueDate ? `Due ${formatISO(t.dueDate, { month: 'short', day: 'numeric' })}` : undefined }),
    id: t.id,
    title: t.title,
    status: STATUS[t.status],
    priority: t.priority,
    due: t.dueDate,
    due_label: dueLabel(t.dueDate, ctx.today) + (t.dueTime ? ` at ${t.dueTime}` : ''),
    assignees: t.assigneeIds.map((id) => ctx.memberNames.get(id) ?? 'former member'),
    assignee_ids: t.assigneeIds,
    project: t.projectName,
    project_id: t.projectId,
    added_by: t.createdBy ? (ctx.memberNames.get(t.createdBy) ?? 'former member') : undefined,
    checklist: t.checklist.total ? `${t.checklist.done}/${t.checklist.total} done` : undefined,
  };
}

export function eventForModel(ctx: LumeCtx, o: EventOccurrence) {
  const when = o.allDay
    ? `${formatISO(o.startDate!, { weekday: 'short', month: 'short', day: 'numeric' })}${o.endDate !== o.startDate ? ` – ${formatISO(o.endDate!, { month: 'short', day: 'numeric' })}` : ''} (all day)`
    : `${formatInstant(o.startsAt!, ctx.tz, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatInstant(o.startsAt!, ctx.tz, { hour: 'numeric', minute: '2-digit' })}–${formatInstant(o.endsAt!, ctx.tz, { hour: 'numeric', minute: '2-digit' })}`;
  return {
    ref: remember(ctx, { type: 'event', id: o.eventId, title: o.title, href: eventHref(o, ctx.tz), subtitle: when }),
    title: o.title,
    when,
    starts_at: o.startsAt,
    ends_at: o.endsAt,
    all_day: o.allDay,
    location: o.location || undefined,
    attendees: o.attendeeIds.map((id) => ctx.memberNames.get(id) ?? 'former member'),
    project: o.projectName ?? undefined,
    added_by: o.createdBy ? (ctx.memberNames.get(o.createdBy) ?? 'former member') : undefined,
    recurring: o.recurring || undefined,
    private: o.visibility === 'private' || undefined,
  };
}

// ─── Definitions ─────────────────────────────────────────────────────────

const str = (description: string) => ({ type: 'string', description });
const date = (description: string) => ({ type: 'string', description: `${description} (YYYY-MM-DD)` });

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_tasks',
    description:
      'List tasks in the workspace. Use view "mine" for the signed-in person\'s open tasks, "team" for everyone\'s open tasks, "overdue", "upcoming" (next 14 days) or "completed". Optional filters narrow the result.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['mine', 'team', 'overdue', 'upcoming', 'completed'] },
        project_id: str('Only tasks in this project'),
        assignee_id: str('Only tasks assigned to this member id'),
        due_from: date('Earliest due date'),
        due_to: date('Latest due date'),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['view'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Full details of one task: description, checklist and recent comments.',
    input_schema: { type: 'object', properties: { task_id: str('Task id') }, required: ['task_id'], additionalProperties: false },
  },
  {
    name: 'list_events',
    description: 'Calendar events between two dates (inclusive, at most 31 days) in the person\'s time zone. scope "mine" = events they organise or attend; "team" = all events they can see.',
    input_schema: {
      type: 'object',
      properties: { from: date('First day'), to: date('Last day'), scope: { type: 'string', enum: ['mine', 'team'] } },
      required: ['from', 'to', 'scope'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: 'Projects with client, stage, status, lead, dates and task progress. status "open" = planned, active or on hold.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'all', 'completed'] } }, additionalProperties: false },
  },
  {
    name: 'get_project',
    description: 'One project with its open tasks and upcoming events.',
    input_schema: { type: 'object', properties: { project_id: str('Project id') }, required: ['project_id'], additionalProperties: false },
  },
  {
    name: 'list_clients',
    description: 'Clients of the agency with contact details and number of projects.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_members',
    description: 'People in the workspace with their member ids, roles and job titles. Use to resolve names to assignee or attendee ids.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_notes',
    description: 'Shared team notes (pinned first, then most recently edited), with who wrote and last edited each. Optional search text matches titles and note text.',
    input_schema: { type: 'object', properties: { query: str('Optional words to search for'), limit: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false },
  },
  {
    name: 'get_profit_summary',
    description:
      'Recorded profit toward the monthly team goal for a calendar month, calculated by the app from saved entries: recorded, target, percent, remaining. Includes recent months and, when permitted, the individual entries.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM; defaults to the current month' } }, additionalProperties: false },
  },
  {
    name: 'propose_create_task',
    description:
      'Propose a new task. Nothing is saved: the person sees a preview and must confirm. Only propose when you know at least the title; ask a short question first if the request is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        title: str('Task title, short and specific'),
        description: str('Optional details'),
        due_date: date('Optional due date'),
        due_time: str('Optional due time HH:MM (requires due_date)'),
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        project_id: str('Optional project id'),
        assignee_ids: { type: 'array', items: { type: 'string' }, description: 'Member ids from list_members' },
        checklist: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_update_task',
    description: 'Propose changing an existing task: mark it complete (status "done"), move it to another status, reschedule it (due_date), change priority or assignees. Nothing is saved until the person confirms.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: str('Task id'),
        status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
        due_date: { type: ['string', 'null'], description: 'New due date YYYY-MM-DD, or null to clear' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        assignee_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_create_event',
    description:
      'Propose a calendar event. Nothing is saved until the person confirms. Timed events need a date, start_time and end_time; ask if the time is unknown. The app checks attendees for conflicts.',
    input_schema: {
      type: 'object',
      properties: {
        title: str('Event title'),
        date: date('Day of the event'),
        start_time: str('HH:MM (24h) in the person\'s time zone'),
        end_time: str('HH:MM (24h)'),
        all_day: { type: 'boolean' },
        end_date: date('Last day for multi-day all-day events'),
        attendee_ids: { type: 'array', items: { type: 'string' } },
        project_id: str('Optional project id'),
        location: str('Optional location or meeting link'),
        description: str('Optional agenda'),
        visibility: { type: 'string', enum: ['team', 'private'] },
      },
      required: ['title', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task_list',
    description: 'Propose several tasks at once, for example a practical task list for an agency project stage. Nothing is saved until the person confirms. At most 12 tasks.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: str('Optional project the tasks belong to'),
        tasks: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              due_date: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
              assignee_ids: { type: 'array', items: { type: 'string' } },
              checklist: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
];

// ─── Execution ───────────────────────────────────────────────────────────

const optDate = z.string().refine(isISODate, 'must be YYYY-MM-DD').optional();
const inputs = {
  list_tasks: z.object({
    view: z.enum(['mine', 'team', 'overdue', 'upcoming', 'completed']),
    project_id: z.string().uuid().optional(),
    assignee_id: z.string().max(64).optional(),
    due_from: optDate,
    due_to: optDate,
    limit: z.number().int().min(1).max(50).optional(),
  }),
  get_task: z.object({ task_id: z.string().uuid() }),
  list_events: z.object({ from: z.string().refine(isISODate), to: z.string().refine(isISODate), scope: z.enum(['mine', 'team']) }),
  list_projects: z.object({ status: z.enum(['open', 'all', 'completed']).optional() }),
  get_project: z.object({ project_id: z.string().uuid() }),
  list_clients: z.object({}),
  list_members: z.object({}),
  list_notes: z.object({ query: z.string().max(100).optional(), limit: z.number().int().min(1).max(30).optional() }),
  get_profit_summary: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
};

export class ToolInputError extends Error {}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export async function runTool(ctx: LumeCtx, name: string, rawInput: unknown): Promise<ToolResult> {
  try {
    const out = await dispatch(ctx, name, rawInput);
    return { content: JSON.stringify(out) };
  } catch (err) {
    if (err instanceof z.ZodError) return { content: `Invalid input: ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, isError: true };
    if (err instanceof ApiError || err instanceof ToolInputError) return { content: err.message, isError: true };
    throw err;
  }
}

async function dispatch(ctx: LumeCtx, name: string, raw: unknown): Promise<unknown> {
  switch (name) {
    case 'list_tasks': {
      const i = inputs.list_tasks.parse(raw);
      touched(ctx, 'Tasks');
      const page = await listTasks(ctx.orgId, ctx.userId, ctx.tz, { view: i.view, projectId: i.project_id, assigneeId: i.assignee_id, from: i.due_from, to: i.due_to, limit: i.limit ?? 30 });
      return { today: ctx.today, count: page.items.length, more_available: page.nextCursor !== null, tasks: page.items.map((t) => taskForModel(ctx, t)) };
    }
    case 'get_task': {
      const i = inputs.get_task.parse(raw);
      touched(ctx, 'Tasks');
      const t = await getTaskDetail(ctx.orgId, i.task_id);
      return {
        ...taskForModel(ctx, t),
        description: t.description.slice(0, 2000) || undefined,
        checklist_items: t.items.map((c) => ({ title: c.title, done: c.done })),
        recent_comments: t.comments.slice(-8).map((c) => ({ by: ctx.memberNames.get(c.authorId ?? '') ?? 'former member', at: c.createdAt, text: c.body.slice(0, 500) })),
      };
    }
    case 'list_events': {
      const i = inputs.list_events.parse(raw);
      if (i.to < i.from) throw new ToolInputError('"to" must be on or after "from".');
      if (diffDays(i.to, i.from) > 31) throw new ToolInputError('Ask for at most 31 days at a time.');
      touched(ctx, 'Calendar');
      const occ = await listOccurrences(ctx.orgId, ctx.userId, { from: i.from, to: i.to, tz: ctx.tz, scope: i.scope });
      return { timezone: ctx.tz, count: occ.length, events: occ.slice(0, 80).map((o) => eventForModel(ctx, o)) };
    }
    case 'list_projects': {
      const i = inputs.list_projects.parse(raw);
      touched(ctx, 'Projects');
      const status = i.status === 'all' ? undefined : i.status === 'completed' ? 'completed' : 'planned,active,on_hold';
      const projects = await listProjects(ctx.orgId, ctx.tz, { status });
      return {
        projects: projects.slice(0, 40).map((p) => ({
          ref: remember(ctx, { type: 'project', id: p.id, title: p.name, href: `/app/projects/${p.id}`, subtitle: p.clientName ?? undefined }),
          id: p.id,
          name: p.name,
          client: p.clientName,
          stage: p.stage,
          status: p.status,
          lead: p.leadId ? ctx.memberNames.get(p.leadId) : null,
          due: p.dueDate ? dueLabel(p.dueDate, ctx.today) : null,
          tasks: `${p.taskCounts.done}/${p.taskCounts.total} done${p.taskCounts.overdue ? `, ${p.taskCounts.overdue} overdue` : ''}`,
        })),
      };
    }
    case 'get_project': {
      const i = inputs.get_project.parse(raw);
      touched(ctx, 'Projects');
      const p = await getProject(ctx.orgId, ctx.tz, i.project_id);
      const [tasks, events] = await Promise.all([
        listTasks(ctx.orgId, ctx.userId, ctx.tz, { view: 'team', projectId: p.id, limit: 40 }),
        listOccurrences(ctx.orgId, ctx.userId, { from: ctx.today, to: addDays(ctx.today, 30), tz: ctx.tz, scope: 'team', projectId: p.id }),
      ]);
      return {
        ref: remember(ctx, { type: 'project', id: p.id, title: p.name, href: `/app/projects/${p.id}`, subtitle: p.clientName ?? undefined }),
        name: p.name,
        client: p.clientName,
        stage: p.stage,
        status: p.status,
        description: p.description?.slice(0, 1500),
        lead: p.leadId ? ctx.memberNames.get(p.leadId) : null,
        start: p.startDate,
        due: p.dueDate ? dueLabel(p.dueDate, ctx.today) : null,
        progress: p.taskCounts,
        open_tasks: tasks.items.map((t) => taskForModel(ctx, t)),
        upcoming_events: events.slice(0, 10).map((o) => eventForModel(ctx, o)),
      };
    }
    case 'list_clients': {
      touched(ctx, 'Clients');
      const clients = await listClients(ctx.orgId);
      return {
        clients: clients.map((c) => ({
          ref: remember(ctx, { type: 'client', id: c.id, title: c.name, href: `/app/clients?client=${c.id}` }),
          name: c.name,
          status: c.status,
          contact: c.contactName,
          projects: c.projectCount,
        })),
      };
    }
    case 'list_members': {
      touched(ctx, 'Team');
      const members = await listMembers(ctx.orgId);
      return { you: ctx.userId, members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, job_title: m.jobTitle })) };
    }
    case 'list_notes': {
      const i = inputs.list_notes.parse(raw);
      touched(ctx, 'Notes');
      const notes = await listNotes(ctx.orgId, { q: i.query, limit: i.limit ?? 15 });
      return {
        count: notes.length,
        notes: notes.map((n) => ({
          ref: remember(ctx, { type: 'note', id: n.id, title: n.title || n.body.slice(0, 40), href: `/app/notes?note=${n.id}` }),
          title: n.title || undefined,
          text: n.body.slice(0, 1500),
          pinned: n.pinned || undefined,
          written_by: ctx.memberNames.get(n.createdBy ?? '') ?? 'former member',
          last_edited_by: n.updatedBy && n.updatedBy !== n.createdBy ? (ctx.memberNames.get(n.updatedBy) ?? 'former member') : undefined,
          updated_at: n.updatedAt,
        })),
      };
    }
    case 'get_profit_summary': {
      const i = inputs.get_profit_summary.parse(raw);
      if (!can(ctx.perm, 'finance.viewSummary')) return { permitted: false, note: 'This person does not have access to profit figures in this workspace. Say so plainly.' };
      touched(ctx, 'Profit');
      const month = i.month ?? monthKey(ctx.today);
      const s = await monthSummary(ctx.orgId, month);
      const hist = await history(ctx.orgId, month, 3);
      const canEntries = can(ctx.perm, 'finance.viewEntries');
      const entries = canEntries ? await listEntries(ctx.orgId, month) : null;
      const isCurrent = month === monthKey(ctx.today);
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return {
        note: 'All figures are recorded PROFIT (not revenue), calculated by the app from saved entries. Quote them exactly; do not compute new money figures.',
        month: formatMonth(month),
        recorded: formatCents(s.recordedCents),
        target: formatCents(s.targetCents),
        percent_of_target: s.percent,
        remaining_to_target: formatCents(s.remainingCents),
        over_target_by: s.overCents > 0 ? formatCents(s.overCents) : undefined,
        achieved: s.achieved,
        entry_count: s.entryCount,
        days_left_in_month: isCurrent ? daysInMonth - Number(ctx.today.slice(8, 10)) : undefined,
        previous_months: hist.slice(0, -1).map((h) => ({ month: formatMonth(h.month), recorded: formatCents(h.recordedCents), target: formatCents(h.targetCents) })),
        entries: entries
          ? entries.slice(0, 30).map((e) => ({
              ref: remember(ctx, { type: 'profit', id: e.id, title: `${formatCents(e.amountCents)} · ${formatISO(e.entryDate, { month: 'short', day: 'numeric' })}`, href: `/app/profit?month=${month}&entry=${e.id}` }),
              date: e.entryDate,
              amount: formatCents(e.amountCents),
              client: e.clientName,
              project: e.projectName,
              note: e.note || undefined,
            }))
          : 'Individual entries are restricted to owners and admins.',
      };
    }
    case 'propose_create_task':
    case 'propose_update_task':
    case 'propose_create_event':
    case 'propose_task_list': {
      const action = await proposeAction(ctx, name, raw);
      ctx.actions.push(action);
      return {
        proposal_id: action.id,
        status: 'awaiting_confirmation',
        warnings: action.warnings.map((w) => w.message),
        note: 'Shown to the person as a preview card with Confirm, Edit and Cancel. It is NOT saved. Do not say it was created or changed. Mention any warnings briefly.',
      };
    }
    default:
      throw new ToolInputError(`Unknown tool ${name}.`);
  }
}

/** Upcoming, not-deleted project deadlines for proposals and summaries. */
export async function projectNameMap(orgId: string) {
  const rows = await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId))).orderBy(asc(schema.projects.name));
  return new Map(rows.map((r) => [r.id, r.name]));
}

