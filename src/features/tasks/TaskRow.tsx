import { Avatar, TaskCheck } from '../../components/ui.tsx';
import { AddedBy } from '../../components/AddedBy.tsx';
import { Icon } from '../../lib/icons.tsx';
import { useMembers } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { dueInfo, STATUSES, useTaskActions } from './taskUtils.ts';
import type { Task } from '../../../shared/types.ts';

export function PriorityDot({ priority }: { priority: Task['priority'] }) {
  return <span className={`priority-dot p-${priority}`} title={`${priority[0].toUpperCase()}${priority.slice(1)} priority`} aria-label={`${priority} priority`} role="img" />;
}

export function AssigneeStack({ ids, size = 22 }: { ids: string[]; size?: number }) {
  const members = useMembers().data ?? [];
  if (ids.length === 0) return <span className="muted-sm">Unassigned</span>;
  const list = ids.map((id) => members.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  return (
    <span className="avatar-stack" aria-label={`Assigned to ${list.map((m) => m.name).join(', ') || 'former members'}`}>
      {list.slice(0, 3).map((m) => (
        <Avatar key={m.id} member={m} size={size} ring />
      ))}
      {ids.length > 3 && (
        <span className="avatar avatar-more avatar-ring" style={{ width: size, height: size }}>
          +{ids.length - 3}
        </span>
      )}
    </span>
  );
}

/** One task in a list. The whole row opens the task; the check completes it. */
export function TaskRow({ task, today, showProject = true, compact = false }: { task: Task; today: string; showProject?: boolean; compact?: boolean }) {
  const ui = useUI();
  const { setStatus } = useTaskActions();
  const due = dueInfo(task, today);
  const done = task.status === 'done';
  return (
    <div className={`task-row ${done ? 'is-done' : ''} ${compact ? 'is-compact' : ''}`}>
      <TaskCheck checked={done} onToggle={() => setStatus(task, done ? 'todo' : 'done')} label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} />
      <button type="button" className="task-row-main" onClick={() => ui.openTask(task.id)}>
        <span className="task-row-title">
          {task.title}
          {task.source === 'lume' && <span className="tag tag-violet tag-xs">Lume</span>}
        </span>
        <span className="task-row-meta">
          <span className={`due due-${due.tone}`}>
            <Icon name="clock" size={13} /> {due.text}
          </span>
          {!compact && task.status !== 'todo' && !done && <span className="status-chip">{STATUSES.find((s) => s.value === task.status)?.label}</span>}
          {showProject && task.projectName && (
            <span className="project-chip">
              <Icon name="projects" size={13} />
              {task.projectName}
            </span>
          )}
          {task.checklist.total > 0 && (
            <span className="meta-count">
              <Icon name="checklist" size={13} /> {task.checklist.done}/{task.checklist.total}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="meta-count">
              <Icon name="chat" size={13} /> {task.commentCount}
            </span>
          )}
          <AddedBy userId={task.createdBy} at={task.createdAt} showVerb />
        </span>
      </button>
      <PriorityDot priority={task.priority} />
      {!compact && <AssigneeStack ids={task.assigneeIds} />}
    </div>
  );
}
