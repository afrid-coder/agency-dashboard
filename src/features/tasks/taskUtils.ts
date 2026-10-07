import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateWork, keys } from '../../lib/queries.ts';
import { useToast } from '../../components/Toast.tsx';
import { useUI } from '../shell/ui.tsx';
import { diffDays, formatISO, relativeDay } from '../../../shared/dates.ts';
import type { Page, Task, TaskStatus } from '../../../shared/types.ts';

export const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Completed' },
];

export function dueInfo(task: Pick<Task, 'dueDate' | 'dueTime' | 'status'>, today: string): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' | 'none' } {
  if (!task.dueDate) return { text: 'No due date', tone: 'none' };
  const d = diffDays(task.dueDate, today);
  const time = task.dueTime ? ` · ${formatTime12(task.dueTime)}` : '';
  if (task.status !== 'done' && d < 0) return { text: `Overdue · ${formatISO(task.dueDate, { month: 'short', day: 'numeric' })}`, tone: 'overdue' };
  if (d === 0) return { text: `Today${time}`, tone: 'today' };
  return { text: relativeDay(task.dueDate, today) + time, tone: d <= 2 ? 'soon' : 'later' };
}

export function formatTime12(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

function patchCaches(qc: QueryClient, id: string, patch: Partial<Task>) {
  qc.setQueriesData<Page<Task>>({ queryKey: keys.tasks }, (old) => (old && 'items' in old ? { ...old, items: old.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : old));
}

/** Common task writes with optimistic list updates, conflict messages and undo. */
export function useTaskActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const ui = useUI();

  const update = useMutation({
    mutationFn: ({ task, changes, base, force }: { task: Task; changes: Partial<Task>; base?: Partial<Task>; force?: boolean }) =>
      api.patch<Task>(`/tasks/${task.id}`, { changes, base: base ?? pick(task, Object.keys(changes) as (keyof Task)[]), force }),
    onMutate: ({ task, changes }) => {
      const snapshot = qc.getQueriesData<Page<Task>>({ queryKey: keys.tasks });
      patchCaches(qc, task.id, changes);
      return { snapshot };
    },
    onError: (err, vars, ctx) => {
      const { task } = vars;
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (err instanceof ApiRequestError && err.code === 'conflict')
        toast({ tone: 'error', message: `“${task.title}” was changed by a teammate. Review it before saving again.`, action: { label: 'Review', onClick: () => ui.openTask(task.id) } });
      else toast({ tone: 'error', message: `Not saved: ${errorMessage(err)}`, action: { label: 'Retry', onClick: () => update.mutate(vars) } });
    },
    onSettled: () => invalidateWork(qc),
  });

  const setStatus = (task: Task, status: TaskStatus) => {
    update.mutate(
      { task, changes: { status } },
      {
        onSuccess: () => {
          if (status === 'done')
            toast({ tone: 'success', message: `Completed “${task.title}”`, action: { label: 'Undo', onClick: () => update.mutate({ task: { ...task, status: 'done' }, changes: { status: task.status } }) } });
        },
      },
    );
  };

  const remove = useMutation({
    mutationFn: (task: Task) => api.del(`/tasks/${task.id}`),
    onSuccess: (_d, task) => {
      invalidateWork(qc);
      if (ui.taskId === task.id) ui.closeTask();
      toast({
        tone: 'info',
        message: `Deleted “${task.title}”`,
        action: {
          label: 'Undo',
          onClick: () =>
            void api
              .post(`/tasks/${task.id}/restore`)
              .then(() => invalidateWork(qc))
              .catch((e) => toast({ tone: 'error', message: errorMessage(e) })),
        },
      });
    },
    onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
  });

  return { update, setStatus, remove };
}

export function pick<T extends object>(obj: T, fields: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}
