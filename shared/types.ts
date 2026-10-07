// API response shapes shared by the server and the interface.
import type { Permission, Role } from './permissions.ts';
import type { Recurrence } from './recurrence.ts';
import type { Stage } from './templates.ts';

export type { Permission, Role, Recurrence, Stage };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    retryable?: boolean;
    retryAfterSeconds?: number;
    details?: unknown;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── Identity ────────────────────────────────────────────────────────────

export interface Member {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: Role;
  timezone: string;
  joinedAt: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
  isDemo: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  weekStartsOn: 0 | 1;
  defaultTargetCents: number;
  membersSeeProfit: boolean;
  isDemo: boolean;
  role: Role;
  permissions: Permission[];
}

export interface PendingInvitation {
  id: string;
  orgName: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: string;
}

export type LumeMode = 'live' | 'demo' | 'unconfigured';

export interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean; avatarUrl: string | null };
  profile: { jobTitle: string | null; timezone: string; onboarded: boolean; hasPin: boolean; autoLockMinutes: number };
  preferences: NotificationPreferences;
  workspaces: OrgSummary[];
  workspace: Workspace | null;
  pendingInvitations: PendingInvitation[];
  /** Not yet an owner or admin of the company workspace, so the admin code would help. */
  adminCodeAvailable: boolean;
  locked: boolean;
  lume: { mode: LumeMode; model: string | null };
}

export interface NotificationPreferences {
  eventReminders: boolean;
  defaultReminderMinutes: number;
  taskAssigned: boolean;
  taskDue: boolean;
  taskComments: boolean;
  emailAssignments: boolean;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface InviteLookup {
  status: 'open' | 'expired' | 'revoked' | 'accepted';
  orgName: string;
  email: string;
  role: Role;
  invitedBy: string | null;
}

// ─── Clients & projects ──────────────────────────────────────────────────

export type ClientStatus = 'lead' | 'active' | 'past';
export interface Client {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  website: string | null;
  notes: string | null;
  status: ClientStatus;
  archived: boolean;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'archived';
export interface Project {
  id: string;
  name: string;
  description: string | null;
  clientId: string | null;
  clientName: string | null;
  stage: Stage;
  status: ProjectStatus;
  leadId: string | null;
  startDate: string | null;
  dueDate: string | null;
  color: string;
  taskCounts: { total: number; done: number; overdue: number };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends Project {
  upcomingEvents: EventOccurrence[];
  profitCents: number | null;
}

// ─── Tasks ───────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  projectId: string | null;
  projectName: string | null;
  assigneeIds: string[];
  checklist: { total: number; done: number };
  commentCount: number;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string | null;
  source: 'manual' | 'lume' | 'template';
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface TaskDetail extends Task {
  items: ChecklistItem[];
  comments: TaskComment[];
  history: ActivityItem[];
}

export type TaskView = 'mine' | 'team' | 'overdue' | 'upcoming' | 'completed';

export interface TaskConflict {
  field: string;
  yours: unknown;
  theirs: unknown;
}

// ─── Calendar ────────────────────────────────────────────────────────────

export interface EventOccurrence {
  /** Unique per occurrence: `${eventId}` or `${eventId}:${occurrenceKey}`. */
  key: string;
  eventId: string;
  occurrenceKey: string | null;
  recurring: boolean;
  recurrence: Recurrence | null;
  isException: boolean;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  projectId: string | null;
  projectName: string | null;
  visibility: 'team' | 'private';
  attendeeIds: string[];
  reminderMinutes: number | null;
  createdBy: string | null;
  version: number;
}

// ─── Profit ──────────────────────────────────────────────────────────────

export interface ProfitSummary {
  month: string;
  recordedCents: number;
  targetCents: number;
  percent: number;
  remainingCents: number;
  overCents: number;
  achieved: boolean;
  entryCount: number;
  targetIsCustom: boolean;
}

export interface ProfitEntry {
  id: string;
  amountCents: number;
  entryDate: string;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  note: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProfitMonth {
  summary: ProfitSummary;
  entries: ProfitEntry[] | null;
  history: { month: string; recordedCents: number; targetCents: number }[];
  canViewEntries: boolean;
}

// ─── Notes ───────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ─── Activity & notifications ────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  actorId: string | null;
  verb: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// ─── Lume ────────────────────────────────────────────────────────────────

export type RecordType = 'task' | 'event' | 'project' | 'client' | 'profit' | 'note';
export interface RecordRef {
  type: RecordType;
  id: string;
  title: string;
  /** In-app path to open the record. */
  href: string;
  subtitle?: string;
}

export type ActionKind = 'create_task' | 'update_task' | 'create_event' | 'create_tasks';
export type ActionStatus = 'proposed' | 'confirmed' | 'cancelled' | 'failed';

export interface ProposedTask {
  title: string;
  description?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: Priority;
  projectId?: string | null;
  assigneeIds?: string[];
  checklist?: string[];
}

export interface ProposedTaskUpdate {
  taskId: string;
  taskTitle: string;
  status?: TaskStatus;
  dueDate?: string | null;
  priority?: Priority;
  assigneeIds?: string[];
  /** Values when the proposal was made, used to detect edits by others before confirmation. */
  base: Partial<Pick<Task, 'status' | 'dueDate' | 'priority' | 'assigneeIds'>>;
}

export interface ProposedEvent {
  title: string;
  description?: string;
  location?: string;
  allDay: boolean;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  endDate?: string | null;
  timezone: string;
  attendeeIds?: string[];
  projectId?: string | null;
  visibility?: 'team' | 'private';
}

export type ActionPayload =
  | { kind: 'create_task'; task: ProposedTask }
  | { kind: 'create_tasks'; projectId: string | null; tasks: ProposedTask[] }
  | { kind: 'update_task'; update: ProposedTaskUpdate }
  | { kind: 'create_event'; event: ProposedEvent };

export interface ActionWarning {
  code: 'conflict' | 'duplicate' | 'past_date' | 'stale';
  message: string;
}

export interface LumeAction {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  payload: ActionPayload;
  warnings: ActionWarning[];
  result: { refs: RecordRef[]; message?: string } | null;
  createdAt: string;
}

export interface LumeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  demo: boolean;
  createdAt: string;
  refs: RecordRef[];
  sources: string[];
  retrievedAt: string | null;
  actionIds: string[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface LumeConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface LumeConversation {
  id: string;
  title: string;
  messages: LumeMessage[];
  actions: LumeAction[];
}

export type LumeStreamEvent =
  | { type: 'start'; conversationId: string; messageId: string; userMessageId: string; demo: boolean }
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'refs'; refs: RecordRef[] }
  | { type: 'action'; action: LumeAction }
  | { type: 'done'; message: LumeMessage }
  | { type: 'error'; code: string; message: string; retryable: boolean };

export interface BriefingPriority {
  text: string;
  refs: RecordRef[];
}

export interface BriefingFacts {
  meetings: EventOccurrence[];
  dueToday: Task[];
  overdue: Task[];
  deadlines: { type: 'task' | 'project'; id: string; title: string; date: string; href: string }[];
  profit: ProfitSummary | null;
}

export interface Briefing {
  scope: 'personal' | 'team';
  day: string;
  timezone: string;
  generatedAt: string;
  demo: boolean;
  model: string | null;
  summary: string;
  priorities: BriefingPriority[];
  facts: BriefingFacts;
  /** When Lume could not write a summary, facts still render. */
  aiError: string | null;
}

/** GET /events/:id — the series row, for editing recurring events. */
export interface EventSeries {
  id: string;
  version: number;
  title: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  recurrence: Recurrence | null;
  createdBy: string | null;
  attendees: { userId: string; response: 'pending' | 'accepted' | 'declined' }[];
  attendeeIds: string[];
}
