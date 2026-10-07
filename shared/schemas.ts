// Input validation shared by forms (friendly messages as you type) and the
// server (authoritative checks on every request).
import { z } from 'zod';
import { isHHMM, isISODate, isValidTimeZone } from './dates.ts';

export const nameSchema = z.string().trim().min(1, 'Enter your name.').max(80, 'Keep your name under 80 characters.');
export const emailSchema = z.string().trim().toLowerCase().max(254, 'That email is too long.').email('Enter a valid email address.');
export const isoDateSchema = z.string().refine(isISODate, 'Choose a valid date.');
export const timeSchema = z.string().refine(isHHMM, 'Use a valid time (HH:MM).');
export const timezoneSchema = z.string().min(1).max(64).refine(isValidTimeZone, 'Choose a valid time zone.');
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a valid month.');
export const uuidSchema = z.string().uuid('That record id is not valid.');
export const pinSchema = z.string().regex(/^\d{4}$/, 'Your PIN must be exactly four digits.');

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '1234567890', '12345678910', 'qwertyuiop', 'qwerty1234',
  'iloveyou12', 'letmein123', 'welcome123', 'admin12345', 'abc1234567', 'lumeracreative', 'lumera123', 'changeme123',
]);

/** Minimum password rules. Length does most of the work; obvious choices are refused. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use 128 characters or fewer.';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose something less predictable.';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character.';
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Don’t include your email address in your password.';
  return null;
}

export const onboardingSchema = z.object({
  name: nameSchema,
  jobTitle: z.string().trim().max(80).optional().nullable(),
  timezone: timezoneSchema,
});

export const profileSchema = onboardingSchema.partial();

export const preferencesSchema = z.object({
  eventReminders: z.boolean(),
  defaultReminderMinutes: z.number().int().min(0).max(1440),
  taskAssigned: z.boolean(),
  taskDue: z.boolean(),
  taskComments: z.boolean(),
  emailAssignments: z.boolean(),
});

export const setPinSchema = z.object({ pin: pinSchema, password: z.string().min(1, 'Enter your password to confirm.').max(128) });
export const unlockSchema = z.object({ pin: pinSchema });
export const securitySchema = z.object({ autoLockMinutes: z.number().int().min(1).max(240) });

// ─── Workspace ───────────────────────────────────────────────────────────

export const adminCodeSchema = z.string().trim().regex(/^\d{4}$/, 'The admin code is four digits.');
export const adminAccessSchema = z.object({ code: adminCodeSchema, timezone: timezoneSchema.optional() });

export const workspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    timezone: timezoneSchema,
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    membersSeeProfit: z.boolean(),
  })
  .partial();

export const inviteSchema = z.object({ email: emailSchema, role: z.enum(['admin', 'member']) });
export const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) });

// ─── Clients & projects ──────────────────────────────────────────────────

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const clientSchema = z.object({
  name: z.string().trim().min(1, 'Enter the client’s name.').max(120),
  contactName: optText(120),
  contactEmail: z
    .union([emailSchema, z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  website: optText(200),
  notes: optText(4000),
  status: z.enum(['lead', 'active', 'past']).default('active'),
});
export const clientPatchSchema = clientSchema.partial().extend({ archived: z.boolean().optional() });

export const stageSchema = z.enum(['discovery', 'design', 'development', 'review', 'launch', 'marketing']);
export const projectStatusSchema = z.enum(['planned', 'active', 'on_hold', 'completed', 'archived']);

const projectFields = {
  name: z.string().trim().min(1, 'Name the project.').max(120),
  description: optText(4000),
  clientId: uuidSchema.nullable().optional(),
  stage: stageSchema.default('discovery'),
  status: projectStatusSchema.default('active'),
  leadId: z.string().max(64).nullable().optional(),
  startDate: isoDateSchema.nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
  color: z.enum(['violet', 'amber', 'teal', 'rose', 'slate', 'olive']).default('violet'),
};

export const projectSchema = z
  .object({
    ...projectFields,
    /** Optional starter tasks for these stages. */
    templates: z.array(stageSchema).max(6).default([]),
    /** New client created in the same step. */
    newClientName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((p) => !p.startDate || !p.dueDate || p.dueDate >= p.startDate, { message: 'The due date must be on or after the start date.', path: ['dueDate'] });

export const projectPatchSchema = z.object({
  changes: z.object(projectFields).partial(),
  base: z.record(z.string(), z.unknown()).default({}),
});

// ─── Tasks ───────────────────────────────────────────────────────────────

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'review', 'done']);
export const prioritySchema = z.enum(['low', 'medium', 'high']);

const taskFields = {
  title: z.string().trim().min(1, 'Give the task a title.').max(200, 'Keep titles under 200 characters.'),
  description: z.string().max(8000, 'Keep the description under 8,000 characters.').default(''),
  status: taskStatusSchema.default('todo'),
  priority: prioritySchema.default('medium'),
  dueDate: isoDateSchema.nullable().default(null),
  dueTime: timeSchema.nullable().default(null),
  projectId: uuidSchema.nullable().default(null),
  assigneeIds: z.array(z.string().max(64)).max(12).default([]),
};

export const taskSchema = z
  .object({
    ...taskFields,
    checklist: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    idempotencyKey: z.string().min(8).max(80).optional(),
  })
  .refine((t) => !t.dueTime || t.dueDate, { message: 'Pick a due date before adding a time.', path: ['dueTime'] });

const taskPatchFields = z
  .object({
    title: taskFields.title,
    description: z.string().max(8000),
    status: taskStatusSchema,
    priority: prioritySchema,
    dueDate: isoDateSchema.nullable(),
    dueTime: timeSchema.nullable(),
    projectId: uuidSchema.nullable(),
    assigneeIds: z.array(z.string().max(64)).max(12),
  })
  .partial();

export const taskPatchSchema = z.object({
  changes: taskPatchFields,
  /** The values the editor started from; used to detect a teammate's edit to the same field. */
  base: z.record(z.string(), z.unknown()).default({}),
  force: z.boolean().optional(),
});

export const checklistItemSchema = z.object({ title: z.string().trim().min(1, 'Enter a checklist item.').max(200) });
export const checklistPatchSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional() });
export const checklistTemplateSchema = z.object({ templateId: z.string().max(40) });
export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment first.').max(4000, 'Keep comments under 4,000 characters.') });

export const taskQuerySchema = z.object({
  view: z.enum(['mine', 'team', 'overdue', 'upcoming', 'completed']).default('team'),
  projectId: uuidSchema.optional(),
  assigneeId: z.string().max(64).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  q: z.string().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// ─── Calendar ────────────────────────────────────────────────────────────

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(12).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: isoDateSchema.nullable().optional(),
  count: z.number().int().min(1).max(730).nullable().optional(),
});

const eventFields = {
  title: z.string().trim().min(1, 'Give the event a title.').max(200),
  description: z.string().max(8000).default(''),
  location: z.string().trim().max(300).default(''),
  allDay: z.boolean().default(false),
  /** Local date in the event time zone (all-day: first day). */
  date: isoDateSchema,
  /** All-day: last day (inclusive). */
  endDate: isoDateSchema.nullable().optional(),
  startTime: timeSchema.nullable().optional(),
  endTime: timeSchema.nullable().optional(),
  /** Timed events that end on a later day. */
  endDateTimed: isoDateSchema.nullable().optional(),
  timezone: timezoneSchema,
  projectId: uuidSchema.nullable().default(null),
  attendeeIds: z.array(z.string().max(64)).max(30).default([]),
  visibility: z.enum(['team', 'private']).default('team'),
  reminderMinutes: z.number().int().min(0).max(10080).nullable().default(null),
  recurrence: recurrenceSchema.nullable().default(null),
};

export const eventSchema = z.object(eventFields).superRefine((e, ctx) => {
  if (!e.allDay) {
    if (!e.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Choose a start time.' });
    if (!e.endTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Choose an end time.' });
    const endDay = e.endDateTimed ?? e.date;
    if (e.startTime && e.endTime && (endDay < e.date || (endDay === e.date && e.endTime <= e.startTime)))
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'The event must end after it starts.' });
  } else if (e.endDate && e.endDate < e.date) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The last day must be on or after the first day.' });
});

export const eventPatchSchema = z.object({
  scope: z.enum(['series', 'occurrence']).default('series'),
  occurrenceKey: z.string().max(40).nullable().optional(),
  version: z.number().int().min(1),
  event: z.object(eventFields),
});

export const eventRangeSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  tz: timezoneSchema,
  scope: z.enum(['team', 'mine']).default('team'),
  projectId: uuidSchema.optional(),
  memberId: z.string().max(64).optional(),
});

// ─── Profit ──────────────────────────────────────────────────────────────

export const profitEntrySchema = z.object({
  amountCents: z
    .number()
    .int('Use whole cents.')
    .refine((v) => v !== 0, 'Enter an amount other than zero.')
    .refine((v) => Math.abs(v) <= 100_000_000, 'Entries are limited to $1,000,000.'),
  entryDate: isoDateSchema,
  clientId: uuidSchema.nullable().default(null),
  projectId: uuidSchema.nullable().default(null),
  note: z.string().trim().max(500, 'Keep notes under 500 characters.').default(''),
  idempotencyKey: z.string().min(8).max(80),
  confirmDuplicate: z.boolean().optional(),
});

export const profitPatchSchema = z.object({
  version: z.number().int().min(1),
  changes: profitEntrySchema.omit({ idempotencyKey: true, confirmDuplicate: true }).partial(),
});

export const targetSchema = z.object({
  month: monthSchema,
  targetCents: z.number().int().min(100, 'Set a target of at least $1.').max(100_000_000_000),
});

// ─── Lume ────────────────────────────────────────────────────────────────

export const LUME_MAX_INPUT_CHARS = 4000;
export const lumeChatSchema = z.object({
  conversationId: uuidSchema.nullable().optional(),
  message: z.string().trim().min(1, 'Type a message first.').max(LUME_MAX_INPUT_CHARS, `Keep messages under ${LUME_MAX_INPUT_CHARS.toLocaleString()} characters.`),
  page: z.enum(['dashboard', 'calendar', 'tasks', 'projects', 'project', 'clients', 'profit', 'settings', 'other']).default('other'),
  timezone: timezoneSchema.optional(),
  retryOf: uuidSchema.optional(),
});

// ─── Notes ───────────────────────────────────────────────────────────────

const noteFields = {
  title: z.string().trim().max(200, 'Keep the title under 200 characters.'),
  body: z.string().max(20000, 'Keep a note under 20,000 characters.'),
  pinned: z.boolean(),
};
const hasContent = (n: { title?: string; body?: string }) => Boolean(n.title?.trim() || n.body?.trim());

export const noteSchema = z
  .object({ title: noteFields.title.default(''), body: noteFields.body.default(''), pinned: noteFields.pinned.default(false), idempotencyKey: z.string().min(8).max(80).optional() })
  .refine(hasContent, { message: 'Write something in the note first.', path: ['body'] });

export const notePatchSchema = z.object({
  version: z.number().int().min(1),
  title: noteFields.title.optional(),
  body: noteFields.body.optional(),
  pinned: noteFields.pinned.optional(),
});
