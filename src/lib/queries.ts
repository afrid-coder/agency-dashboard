import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { api, qs } from './api.ts';
import type {
  ActivityItem,
  Briefing,
  Client,
  EventOccurrence,
  InvitationRow,
  LumeConversation,
  LumeConversationSummary,
  Me,
  Member,
  Note,
  NotificationItem,
  Page,
  ProfitMonth,
  Project,
  ProjectDetail,
  Task,
  TaskDetail,
  TaskView,
} from '../../shared/types.ts';

export const keys = {
  me: ['me'] as const,
  members: ['members'] as const,
  invitations: ['invitations'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['task', id] as const,
  events: ['events'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  clients: ['clients'] as const,
  profit: ['profit'] as const,
  activity: ['activity'] as const,
  notifications: ['notifications'] as const,
  briefing: ['briefing'] as const,
  lumeConversations: ['lume', 'conversations'] as const,
  lumeConversation: (id: string) => ['lume', 'conversation', id] as const,
  lumeStatus: ['lume', 'status'] as const,
  notes: ['notes'] as const,
};

export const useMe = (enabled = true) => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/me'), enabled, staleTime: 30_000, retry: false });
export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => api.get<Member[]>('/members'), staleTime: 60_000 });
export const useInvitations = (enabled: boolean) => useQuery({ queryKey: keys.invitations, queryFn: () => api.get<InvitationRow[]>('/invitations'), enabled });

export interface TaskParams {
  view: TaskView;
  projectId?: string;
  assigneeId?: string;
  status?: string;
  priority?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}
export const useTasks = (p: TaskParams, enabled = true) =>
  useQuery({ queryKey: [...keys.tasks, p], queryFn: () => api.get<Page<Task>>(`/tasks${qs({ ...p })}`), placeholderData: keepPreviousData, enabled });

export const useTaskPages = (p: TaskParams) =>
  useInfiniteQuery({
    queryKey: [...keys.tasks, 'pages', p],
    queryFn: ({ pageParam }) => api.get<Page<Task>>(`/tasks${qs({ ...p, cursor: pageParam as string | undefined, limit: p.limit ?? 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const useTask = (id: string | null) => useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => api.get<TaskDetail>(`/tasks/${id}`), enabled: Boolean(id) });

export interface EventParams {
  from: string;
  to: string;
  tz: string;
  scope?: 'team' | 'mine';
  projectId?: string;
  memberId?: string;
}
export const useEvents = (p: EventParams, enabled = true) =>
  useQuery({ queryKey: [...keys.events, p], queryFn: () => api.get<EventOccurrence[]>(`/events${qs({ ...p })}`), placeholderData: keepPreviousData, enabled });

export const useProjects = (status?: string) => useQuery({ queryKey: [...keys.projects, status ?? 'all'], queryFn: () => api.get<Project[]>(`/projects${qs({ status })}`) });
export const useProject = (id: string) => useQuery({ queryKey: keys.project(id), queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
export const useClients = (archived = false) => useQuery({ queryKey: [...keys.clients, archived], queryFn: () => api.get<Client[]>(`/clients${qs({ archived: archived ? 1 : undefined })}`) });
export const useProfit = (month: string | undefined, enabled = true) =>
  useQuery({ queryKey: [...keys.profit, month ?? 'current'], queryFn: () => api.get<ProfitMonth>(`/profit${qs({ month })}`), placeholderData: keepPreviousData, enabled, retry: false });

export const useActivity = () =>
  useInfiniteQuery({
    queryKey: keys.activity,
    queryFn: ({ pageParam }) => api.get<Page<ActivityItem>>(`/activity${qs({ cursor: pageParam as string | undefined, limit: 20 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => api.get<Page<NotificationItem> & { unread: number }>('/notifications'), staleTime: 15_000 });

export const useBriefing = (scope: 'personal' | 'team') => useQuery({ queryKey: [...keys.briefing, scope], queryFn: () => api.get<Briefing>(`/lume/briefing${qs({ scope })}`), staleTime: 60_000, retry: 1 });

export const useLumeConversations = (enabled: boolean) => useQuery({ queryKey: keys.lumeConversations, queryFn: () => api.get<LumeConversationSummary[]>('/lume/conversations'), enabled });
export const useLumeConversation = (id: string | null) =>
  useQuery({ queryKey: keys.lumeConversation(id ?? ''), queryFn: () => api.get<LumeConversation>(`/lume/conversations/${id}`), enabled: Boolean(id), staleTime: Infinity });

export function invalidateWork(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.tasks });
  void qc.invalidateQueries({ queryKey: ['task'] });
  void qc.invalidateQueries({ queryKey: keys.projects });
  void qc.invalidateQueries({ queryKey: ['project'] });
  void qc.invalidateQueries({ queryKey: keys.briefing });
}
export function invalidateEvents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.events });
  void qc.invalidateQueries({ queryKey: ['project'] });
  void qc.invalidateQueries({ queryKey: keys.briefing });
}
export function invalidateProfit(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.profit });
  void qc.invalidateQueries({ queryKey: ['project'] });
}

export const useNotes = (q?: string) =>
  useQuery({ queryKey: [...keys.notes, q ?? ''], queryFn: () => api.get<Note[]>(`/notes${qs({ q: q || undefined })}`), placeholderData: keepPreviousData });
