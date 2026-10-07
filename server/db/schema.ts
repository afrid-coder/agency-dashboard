// Lumera Creative workspace — PostgreSQL schema.
//
// Change this file, then run `npm run db:generate` to write a new SQL
// migration into server/db/migrations. Migrations are applied automatically
// on server start (and by `npm run db:migrate`).
//
// Conventions
// - Timestamps are timestamptz (UTC instants). Calendar dates that belong to
//   the workspace (due dates, profit dates, all-day events) are plain `date`.
// - Money is integer cents in bigint columns.
// - Every business table carries org_id so each query can be scoped to the
//   caller's workspace.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();

// ─── Authentication (managed by Better Auth) ─────────────────────────────

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: updated(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: created(),
    updatedAt: updated(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

// ─── People & workspaces ─────────────────────────────────────────────────

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    timezone: text('timezone').notNull().default('America/New_York'),
    weekStartsOn: smallint('week_starts_on').notNull().default(1),
    defaultTargetCents: bigint('default_target_cents', { mode: 'number' }).notNull().default(50_000),
    membersSeeProfit: boolean('members_see_profit').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check('org_week_start_chk', sql`${t.weekStartsOn} in (0, 1)`),
    check('org_target_chk', sql`${t.defaultTargetCents} > 0`),
    check('org_name_chk', sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const profiles = pgTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  jobTitle: text('job_title'),
  timezone: text('timezone').notNull().default('UTC'),
  onboardedAt: ts('onboarded_at'),
  activeOrgId: uuid('active_org_id').references(() => organizations.id, { onDelete: 'set null' }),
  /** Optional quick-unlock PIN (never a sign-in credential). scrypt + server pepper. */
  pinHash: text('pin_hash'),
  pinUpdatedAt: ts('pin_updated_at'),
  /** Minutes of inactivity before a session with a PIN locks. */
  autoLockMinutes: integer('auto_lock_minutes').notNull().default(15),
  updatedAt: updated(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  eventReminders: boolean('event_reminders').notNull().default(true),
  defaultReminderMinutes: integer('default_reminder_minutes').notNull().default(10),
  taskAssigned: boolean('task_assigned').notNull().default(true),
  taskDue: boolean('task_due').notNull().default(true),
  taskComments: boolean('task_comments').notNull().default(true),
  emailAssignments: boolean('email_assignments').notNull().default(false),
  updatedAt: updated(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('membership_org_user_uq').on(t.orgId, t.userId),
    index('membership_user_idx').on(t.userId),
    check('membership_role_chk', sql`${t.role} in ('owner', 'admin', 'member')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: ts('revoked_at'),
    createdAt: created(),
  },
  (t) => [
    check('invitation_role_chk', sql`${t.role} in ('admin', 'member')`),
    check('invitation_email_chk', sql`${t.email} = lower(${t.email})`),
    uniqueIndex('invitation_open_uq')
      .on(t.orgId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index('invitation_email_idx').on(t.email),
  ],
);

/** Quick-unlock state for a signed-in session (only used when the user set a PIN). */
export const sessionLocks = pgTable('session_locks', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  lockedAt: ts('locked_at'),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
});

// ─── Clients & projects ──────────────────────────────────────────────────

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    website: text('website'),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    check('client_status_chk', sql`${t.status} in ('lead', 'active', 'past')`),
    check('client_name_chk', sql`char_length(${t.name}) between 1 and 120`),
    uniqueIndex('client_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    stage: text('stage').notNull().default('discovery'),
    status: text('status').notNull().default('active'),
    leadId: text('lead_id').references(() => user.id, { onDelete: 'set null' }),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    color: text('color').notNull().default('violet'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('project_idempotency_uq').on(t.orgId, t.idempotencyKey),
    check('project_stage_chk', sql`${t.stage} in ('discovery', 'design', 'development', 'review', 'launch', 'marketing')`),
    check('project_status_chk', sql`${t.status} in ('planned', 'active', 'on_hold', 'completed', 'archived')`),
    check('project_dates_chk', sql`${t.dueDate} is null or ${t.startDate} is null or ${t.dueDate} >= ${t.startDate}`),
    check('project_name_chk', sql`char_length(${t.name}) between 1 and 120`),
    index('project_org_status_idx').on(t.orgId, t.status),
    index('project_client_idx').on(t.clientId),
  ],
);

// ─── Tasks ───────────────────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('todo'),
    priority: text('priority').notNull().default('medium'),
    dueDate: date('due_date', { mode: 'string' }),
    dueTime: time('due_time'),
    completedAt: ts('completed_at'),
    completedBy: text('completed_by').references(() => user.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
    /** Soft delete so a deletion can be undone; purged after 30 days. */
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('task_idempotency_uq').on(t.orgId, t.idempotencyKey),
    check('task_status_chk', sql`${t.status} in ('todo', 'in_progress', 'review', 'done')`),
    check('task_priority_chk', sql`${t.priority} in ('low', 'medium', 'high')`),
    check('task_source_chk', sql`${t.source} in ('manual', 'lume', 'template')`),
    check('task_title_chk', sql`char_length(${t.title}) between 1 and 200`),
    check('task_due_time_chk', sql`${t.dueTime} is null or ${t.dueDate} is not null`),
    check('task_done_chk', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
    index('task_org_due_idx').on(t.orgId, t.dueDate),
    index('task_org_status_idx').on(t.orgId, t.status),
    index('task_project_idx').on(t.projectId),
  ],
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
    assignedAt: created(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index('task_assignee_user_idx').on(t.userId)],
);

/** Subtasks — the task's checklist. */
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull(),
    doneBy: text('done_by').references(() => user.id, { onDelete: 'set null' }),
    doneAt: ts('done_at'),
    createdAt: created(),
  },
  (t) => [index('checklist_task_idx').on(t.taskId, t.position), check('checklist_title_chk', sql`char_length(${t.title}) between 1 and 200`)],
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: created(),
    editedAt: ts('edited_at'),
  },
  (t) => [index('comment_task_idx').on(t.taskId, t.createdAt), check('comment_body_chk', sql`char_length(${t.body}) between 1 and 4000`)],
);

// ─── Calendar ────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    allDay: boolean('all_day').notNull().default(false),
    /** Timed events: absolute instants. */
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    /** All-day events: inclusive date range. */
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** IANA zone the event was scheduled in; recurrences keep this wall-clock time across DST. */
    timezone: text('timezone').notNull(),
    /** Basic recurrence rule, see shared/recurrence.ts. */
    recurrence: jsonb('recurrence'),
    visibility: text('visibility').notNull().default('team'),
    reminderMinutes: integer('reminder_minutes'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual'),
    idempotencyKey: text('idempotency_key'),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('event_idempotency_uq').on(t.orgId, t.idempotencyKey),
    check('event_visibility_chk', sql`${t.visibility} in ('team', 'private')`),
    check('event_title_chk', sql`char_length(${t.title}) between 1 and 200`),
    check(
      'event_time_chk',
      sql`(${t.allDay} and ${t.startDate} is not null and ${t.endDate} is not null and ${t.endDate} >= ${t.startDate})
        or (not ${t.allDay} and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.endsAt} > ${t.startsAt})`,
    ),
    check('event_reminder_chk', sql`${t.reminderMinutes} is null or ${t.reminderMinutes} between 0 and 10080`),
    index('event_org_start_idx').on(t.orgId, t.startsAt),
    index('event_org_date_idx').on(t.orgId, t.startDate),
    index('event_project_idx').on(t.projectId),
  ],
);

export const eventAttendees = pgTable(
  'event_attendees',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    response: text('response').notNull().default('pending'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index('attendee_user_idx').on(t.userId),
    check('attendee_response_chk', sql`${t.response} in ('pending', 'accepted', 'declined')`),
  ],
);

/** One changed or cancelled occurrence of a recurring event. */
export const eventExceptions = pgTable(
  'event_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** Original occurrence key: ISO instant (timed) or YYYY-MM-DD (all-day). */
    occurrenceKey: text('occurrence_key').notNull(),
    cancelled: boolean('cancelled').notNull().default(false),
    override: jsonb('override'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('event_exception_uq').on(t.eventId, t.occurrenceKey)],
);

// ─── Profit ──────────────────────────────────────────────────────────────

export const profitEntries = pgTable(
  'profit_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    note: text('note').notNull().default(''),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: ts('deleted_at'),
    deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('profit_amount_chk', sql`${t.amountCents} <> 0 and abs(${t.amountCents}) <= 100000000`),
    uniqueIndex('profit_idempotency_uq').on(t.orgId, t.idempotencyKey),
    index('profit_org_date_idx')
      .on(t.orgId, t.entryDate)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Target for a calendar month. Months without a row inherit the latest earlier row, then the workspace default. */
export const profitGoals = pgTable(
  'profit_goals',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    month: date('month', { mode: 'string' }).notNull(),
    targetCents: bigint('target_cents', { mode: 'number' }).notNull(),
    setBy: text('set_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.month] }),
    check('goal_target_chk', sql`${t.targetCents} > 0 and ${t.targetCents} <= 100000000000`),
    check('goal_month_chk', sql`extract(day from ${t.month}) = 1`),
  ],
);

// ─── Lume ────────────────────────────────────────────────────────────────

export const lumeConversations = pgTable(
  'lume_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New conversation'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('lume_conv_owner_idx').on(t.orgId, t.userId, t.updatedAt)],
);

export const lumeMessages = pgTable(
  'lume_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => lumeConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    text: text('text').notNull().default(''),
    /** Linked records, data sources, retrieval time, proposal ids, error state. */
    meta: jsonb('meta').notNull().default({}),
    model: text('model'),
    demo: boolean('demo').notNull().default(false),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: created(),
  },
  (t) => [index('lume_msg_conv_idx').on(t.conversationId, t.createdAt), check('lume_msg_role_chk', sql`${t.role} in ('user', 'assistant')`)],
);

/** A change Lume proposed. Nothing is written to tasks/events until a person confirms it. */
export const lumeActions = pgTable(
  'lume_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => lumeConversations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('proposed'),
    result: jsonb('result'),
    createdAt: created(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    check('lume_action_kind_chk', sql`${t.kind} in ('create_task', 'update_task', 'create_event', 'create_tasks')`),
    check('lume_action_status_chk', sql`${t.status} in ('proposed', 'confirmed', 'cancelled', 'failed')`),
    index('lume_action_conv_idx').on(t.conversationId),
  ],
);

export const lumeBriefings = pgTable(
  'lume_briefings',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    content: jsonb('content').notNull(),
    model: text('model'),
    demo: boolean('demo').notNull().default(false),
    generatedAt: ts('generated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId, t.scope, t.day] }), check('briefing_scope_chk', sql`${t.scope} in ('personal', 'team')`)],
);

export const lumeUsage = pgTable(
  'lume_usage',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId, t.day] })],
);

// ─── Notes ───────────────────────────────────────────────────────────────

/** Shared team notes. Everyone in the workspace reads and edits them; each keeps who wrote it and who last edited it. */
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('note_idempotency_uq').on(t.orgId, t.idempotencyKey),
    check('note_title_chk', sql`char_length(${t.title}) <= 200`),
    check('note_body_chk', sql`char_length(${t.body}) <= 20000`),
    check('note_not_empty_chk', sql`char_length(${t.title}) + char_length(${t.body}) > 0`),
    index('note_org_idx').on(t.orgId, t.pinned, t.updatedAt),
  ],
);

// ─── Notifications & activity ────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    dedupeKey: text('dedupe_key').notNull(),
    readAt: ts('read_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('notification_dedupe_uq').on(t.userId, t.dedupeKey), index('notification_user_idx').on(t.userId, t.createdAt)],
);

export const activity = pgTable(
  'activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    verb: text('verb').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    /** Restricted entries (profit) are only shown to people with finance access. */
    restricted: boolean('restricted').notNull().default(false),
    createdAt: created(),
  },
  (t) => [index('activity_org_idx').on(t.orgId, t.createdAt)],
);

/** Development only: captured email when no provider is configured. */
export const devOutbox = pgTable('dev_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  link: text('link'),
  createdAt: created(),
});

/** Profile photos, stored in the database so they survive redeploys and are included in backups. */
export const avatars = pgTable(
  'avatars',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    data: text('data').notNull(),
    updatedAt: updated(),
  },
  (t) => [check('avatar_mime_chk', sql`${t.mime} in ('image/webp', 'image/jpeg', 'image/png')`), check('avatar_size_chk', sql`char_length(${t.data}) <= 700000`)],
);
