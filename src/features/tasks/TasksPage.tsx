import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Button, EmptyState, Menu, Notice, Segmented, Skeleton } from '../../components/ui.tsx';
import { AddedBy } from '../../components/AddedBy.tsx';
import { Icon } from '../../lib/icons.tsx';
import { useMembers, useProjects, useTaskPages, type TaskParams } from '../../lib/queries.ts';
import { errorMessage } from '../../lib/api.ts';
import { storage } from '../../lib/theme.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { TaskRow, PriorityDot, AssigneeStack } from './TaskRow.tsx';
import { STATUSES, dueInfo, useTaskActions } from './taskUtils.ts';
import { todayIn } from '../../../shared/dates.ts';
import type { Task, TaskStatus, TaskView } from '../../../shared/types.ts';

const VIEWS: { value: TaskView; label: string }[] = [
  { value: 'mine', label: 'My tasks' },
  { value: 'team', label: 'Team' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
];

const layoutPref = storage<'list' | 'board'>('lumera.tasks.layout', 'list');

export function TasksPage() {
  const me = useMeData();
  const ui = useUI();
  const [params, setParams] = useSearchParams();
  const today = todayIn(tzOf(me));
  const view = (params.get('view') as TaskView) || 'mine';
  const [layout, setLayout] = useState<'list' | 'board'>(layoutPref.get());
  const [q, setQ] = useState(params.get('q') ?? '');
  const members = useMembers().data ?? [];
  const projects = useProjects().data ?? [];

  const set = (k: string, v: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  // Debounce search into the URL.
  useEffect(() => {
    const t = window.setTimeout(() => set('q', q.trim() || null), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    document.title = 'Tasks · Lumera Creative';
  }, []);

  const filters: TaskParams = {
    view,
    projectId: params.get('project') ?? undefined,
    assigneeId: params.get('assignee') ?? undefined,
    status: layout === 'board' ? (view === 'completed' ? 'done' : 'todo,in_progress,review,done') : (params.get('status') ?? undefined),
    priority: params.get('priority') ?? undefined,
    q: params.get('q') ?? undefined,
    limit: layout === 'board' ? 200 : 50,
  };
  const pages = useTaskPages(filters);
  const tasks = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  const activeFilters = ['project', 'assignee', 'status', 'priority', 'q'].filter((k) => params.get(k)).length;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Work</p>
          <h1 className="page-title">Tasks</h1>
        </div>
        <div className="page-actions">
          <Segmented
            label="Layout"
            size="sm"
            value={layout}
            onChange={(v) => {
              setLayout(v);
              layoutPref.set(v);
            }}
            options={[
              { value: 'list', label: 'List', icon: 'list' },
              { value: 'board', label: 'Board', icon: 'board' },
            ]}
          />
          <Button variant="primary" icon="plus" onClick={() => ui.openNewTask({ projectId: params.get('project'), assigneeIds: view === 'mine' ? [me.user.id] : [] })}>
            New task
          </Button>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Task views">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={view === v.value} className={`tab-btn ${view === v.value ? 'is-active' : ''}`} onClick={() => set('view', v.value === 'mine' ? null : v.value)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <div className="search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="task-search">
            Search tasks
          </label>
          <input id="task-search" className="input" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="f-project">
          Project
        </label>
        <select id="f-project" className="select select-sm" value={params.get('project') ?? ''} onChange={(e) => set('project', e.target.value || null)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {view !== 'mine' && (
          <>
            <label className="sr-only" htmlFor="f-assignee">
              Assignee
            </label>
            <select id="f-assignee" className="select select-sm" value={params.get('assignee') ?? ''} onChange={(e) => set('assignee', e.target.value || null)}>
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        )}
        {layout === 'list' && view !== 'completed' && (
          <>
            <label className="sr-only" htmlFor="f-status">
              Status
            </label>
            <select id="f-status" className="select select-sm" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value || null)}>
              <option value="">Open statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="f-priority">
          Priority
        </label>
        <select id="f-priority" className="select select-sm" value={params.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value || null)}>
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            onClick={() => {
              setQ('');
              setParams(view === 'mine' ? {} : { view }, { replace: true });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {pages.isError && <Notice tone="danger" action={<Button size="sm" onClick={() => void pages.refetch()}>Retry</Button>}>{errorMessage(pages.error)}</Notice>}
      {pages.isPending ? (
        <div className="card list-card">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="task-row">
              <Skeleton w={20} h={20} r={10} />
              <Skeleton h={16} />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={view === 'overdue' ? 'checkFilled' : 'tasks'}
            title={activeFilters ? 'No tasks match these filters' : view === 'overdue' ? 'Nothing overdue' : view === 'mine' ? 'Nothing assigned to you' : view === 'completed' ? 'No completed tasks yet' : 'No tasks yet'}
            action={
              !activeFilters && view !== 'overdue' && view !== 'completed' ? (
                <Button variant="secondary" icon="plus" onClick={() => ui.openNewTask({ assigneeIds: view === 'mine' ? [me.user.id] : [] })}>
                  Create a task
                </Button>
              ) : undefined
            }
          >
            {activeFilters ? 'Try clearing a filter.' : view === 'overdue' ? 'Every open task is on schedule.' : 'Add work you need to track, or ask Lume to draft a task list for a project.'}
          </EmptyState>
        </div>
      ) : layout === 'list' ? (
        <TaskList tasks={tasks} today={today} grouped={view === 'team' || view === 'mine'} />
      ) : (
        <TaskBoard tasks={tasks} today={today} />
      )}
      {pages.hasNextPage && (
        <div className="load-more">
          <Button variant="secondary" onClick={() => void pages.fetchNextPage()} loading={pages.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function TaskList({ tasks, today, grouped }: { tasks: Task[]; today: string; grouped: boolean }) {
  if (!grouped)
    return (
      <div className="card list-card">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} today={today} />
        ))}
      </div>
    );
  const groups: { label: string; items: Task[] }[] = [
    { label: 'Overdue', items: tasks.filter((t) => dueInfo(t, today).tone === 'overdue') },
    { label: 'Today', items: tasks.filter((t) => dueInfo(t, today).tone === 'today') },
    { label: 'Next few days', items: tasks.filter((t) => dueInfo(t, today).tone === 'soon') },
    { label: 'Later', items: tasks.filter((t) => dueInfo(t, today).tone === 'later') },
    { label: 'No due date', items: tasks.filter((t) => !t.dueDate) },
  ].filter((g) => g.items.length);
  return (
    <div className="stack-lg">
      {groups.map((g) => (
        <section key={g.label} className="card list-card" aria-label={g.label}>
          <h2 className={`list-group-title ${g.label === 'Overdue' ? 'is-overdue' : ''}`}>
            {g.label} <span className="muted-sm">{g.items.length}</span>
          </h2>
          {g.items.map((t) => (
            <TaskRow key={t.id} task={t} today={today} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Kanban by status. Drag cards between columns, or use each card's menu. */
function TaskBoard({ tasks, today }: { tasks: Task[]; today: string }) {
  const { setStatus } = useTaskActions();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = (e: DragEndEvent) => {
    const task = tasks.find((t) => t.id === e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    if (task && to && to !== task.status) setStatus(task, to);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="board">
        {STATUSES.map((s) => (
          <BoardColumn key={s.value} status={s.value} label={s.label} tasks={tasks.filter((t) => t.status === s.value)} today={today} />
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({ status, label, tasks, today }: { status: TaskStatus; label: string; tasks: Task[]; today: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const ui = useUI();
  return (
    <section ref={setNodeRef} className={`board-col ${isOver ? 'is-over' : ''}`} aria-label={`${label}, ${tasks.length} tasks`}>
      <header className="board-col-head">
        <span className={`status-pip s-${status}`} />
        {label}
        <span className="muted-sm">{tasks.length}</span>
        {status !== 'done' && (
          <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost board-add" aria-label={`Add task to ${label}`} onClick={() => ui.openNewTask({ status })}>
            <Icon name="plus" size={15} />
          </button>
        )}
      </header>
      <div className="board-cards">
        {tasks.map((t) => (
          <BoardCard key={t.id} task={t} today={today} />
        ))}
        {tasks.length === 0 && <p className="board-empty">Drop tasks here</p>}
      </div>
    </section>
  );
}

function BoardCard({ task, today }: { task: Task; today: string }) {
  const ui = useUI();
  const { setStatus } = useTaskActions();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const due = dueInfo(task, today);
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <article ref={setNodeRef} style={style} className={`board-card ${isDragging ? 'is-dragging' : ''}`} {...attributes} {...listeners} aria-roledescription="Draggable task">
      <div className="board-card-top">
        <PriorityDot priority={task.priority} />
        <button type="button" className="board-card-title" onClick={() => ui.openTask(task.id)} onPointerDown={(e) => e.stopPropagation()}>
          {task.title}
        </button>
        <span onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu
            label={`Move ${task.title}`}
            items={STATUSES.filter((s) => s.value !== task.status).map((s) => ({ label: `Move to ${s.label}`, icon: 'arrowRight' as const, onSelect: () => setStatus(task, s.value) }))}
          />
        </span>
      </div>
      {task.projectName && <p className="board-card-project">{task.projectName}</p>}
      <div className="board-card-meta">
        <span className={`due due-${due.tone}`}>{due.text}</span>
        <AddedBy userId={task.createdBy} at={task.createdAt} />
        <AssigneeStack ids={task.assigneeIds} size={20} />
      </div>
    </article>
  );
}
