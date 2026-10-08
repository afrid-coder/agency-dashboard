// Task details in a side panel (bottom sheet on mobile). Every field saves as
// soon as it changes, with a visible save state. If a teammate changed the
// same field meanwhile, nothing is overwritten: the person chooses.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Avatar, Button, Checkbox, EmptyState, Field, IconButton, Menu, Notice, Segmented, Skeleton } from '../../components/ui.tsx';
import { ConfirmDialog, MemberPicker, SaveState, type SaveStatus } from '../../components/extras.tsx';
import { appHref } from '../../lib/auth.ts';
import { AddedBy } from '../../components/AddedBy.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateWork, keys, useMembers, useProjects, useTask } from '../../lib/queries.ts';
import { relativeTime } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { can, useMeData } from '../shell/me.tsx';
import { STATUSES, useTaskActions } from './taskUtils.ts';
import { CHECKLIST_TEMPLATES } from '../../../shared/templates.ts';
import type { ChecklistItem, Priority, TaskConflict, TaskDetail, TaskStatus } from '../../../shared/types.ts';

type Editable = 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'dueTime' | 'projectId' | 'assigneeIds';

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  dueDate: 'due date',
  dueTime: 'due time',
  projectId: 'project',
  assigneeIds: 'assignees',
};

export function TaskPanel() {
  const ui = useUI();
  const q = useTask(ui.taskId);
  return (
    <Dialog
      open={Boolean(ui.taskId)}
      onClose={ui.closeTask}
      variant="panel"
      size="lg"
      eyebrow="Task"
      title={q.data ? (q.data.projectName ?? 'No project') : q.isError ? 'Task unavailable' : 'Loading task…'}
      headerAside={q.data ? <TaskMenu task={q.data} /> : null}
    >
      {q.isPending && ui.taskId && (
        <div className="stack">
          <Skeleton h={34} />
          <Skeleton h={120} />
          <Skeleton h={80} />
        </div>
      )}
      {q.isError && (
        <EmptyState icon="info" title="This task isn’t available">
          {errorMessage(q.error)}
        </EmptyState>
      )}
      {q.data && <TaskEditor key={q.data.id} task={q.data} />}
    </Dialog>
  );
}

function TaskMenu({ task }: { task: TaskDetail }) {
  const me = useMeData();
  const { remove } = useTaskActions();
  const [confirm, setConfirm] = useState(false);
  const canDelete = can(me, 'tasks.deleteAny') || task.createdBy === me.user.id;
  return (
    <>
      <Menu
        label="Task actions"
        items={[
          {
            label: 'Copy link',
            icon: 'link',
            onSelect: () => void navigator.clipboard?.writeText(appHref(`/app/tasks?task=${task.id}`)),
          },
          { label: 'Delete task', icon: 'trash', danger: true, disabled: !canDelete, onSelect: () => setConfirm(true) },
        ]}
      />
      <ConfirmDialog
        open={confirm}
        title="Delete this task?"
        confirmLabel="Delete task"
        busy={remove.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(task, { onSettled: () => setConfirm(false) })}
      >
        “{task.title}” and its checklist and comments will be removed. You can undo right after deleting.
      </ConfirmDialog>
    </>
  );
}

function TaskEditor({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers().data ?? [];
  const projects = useProjects().data ?? [];
  const [status, setSaveStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<{ conflicts: TaskConflict[]; changes: Record<string, unknown> } | null>(null);
  const [lastFailed, setLastFailed] = useState<{ changes: Record<string, unknown>; base: Record<string, unknown> } | null>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const editingBase = useRef<Record<string, unknown>>({});
  const savedTimer = useRef<number | undefined>(undefined);

  // Follow teammates' changes to fields you aren't currently editing.
  useEffect(() => {
    if (!('title' in editingBase.current)) setTitle(task.title);
    if (!('description' in editingBase.current)) setDescription(task.description);
  }, [task.title, task.description]);

  const save = async (changes: Partial<Record<Editable, unknown>>, base: Record<string, unknown>, force = false) => {
    setSaveStatus('saving');
    setLastFailed(null);
    window.clearTimeout(savedTimer.current);
    try {
      await api.patch(`/tasks/${task.id}`, { changes, base, force });
      setConflict(null);
      setSaveStatus('saved');
      savedTimer.current = window.setTimeout(() => setSaveStatus('idle'), 2200);
      invalidateWork(qc);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'conflict') {
        setSaveStatus('idle');
        setConflict({ conflicts: (err.details as { conflicts: TaskConflict[] }).conflicts, changes });
        void qc.invalidateQueries({ queryKey: keys.task(task.id) });
      } else {
        setSaveStatus('error');
        setLastFailed({ changes, base });
        toast({ tone: 'error', message: `Not saved: ${errorMessage(err)}` });
      }
    }
  };

  const saveField = (field: Editable, value: unknown) => {
    const current = (task as unknown as Record<string, unknown>)[field];
    // The value this edit started from: captured on focus for text, else what is shown now.
    const base = field in editingBase.current ? editingBase.current[field] : current;
    delete editingBase.current[field];
    if (JSON.stringify(value) === JSON.stringify(base)) return;
    void save({ [field]: value }, { [field]: base });
  };

  const beginEdit = (field: Editable) => {
    if (!(field in editingBase.current)) editingBase.current[field] = (task as unknown as Record<string, unknown>)[field];
  };

  return (
    <div className="task-editor">
      <div className="task-editor-top">
        <AddedBy userId={task.createdBy} at={task.createdAt} variant="text" full />
        {task.status === 'done' && task.completedBy && <AddedBy userId={task.completedBy} at={task.completedAt ?? undefined} variant="text" verb="Completed by" full />}
        <SaveState status={status} onRetry={lastFailed ? () => void save(lastFailed.changes, lastFailed.base) : undefined} />
        {task.source === 'lume' && <span className="tag tag-violet">Created with Lume</span>}
        {task.source === 'template' && <span className="tag">From a starter template</span>}
      </div>

      {conflict && (
        <Notice
          tone="warning"
          action={
            <div className="conflict-actions">
              <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>
                Keep theirs
              </Button>
              <Button size="sm" variant="primary" onClick={() => void save(conflict.changes as Partial<Record<Editable, unknown>>, {}, true)}>
                Use mine
              </Button>
            </div>
          }
        >
          A teammate changed the {conflict.conflicts.map((c) => FIELD_LABEL[c.field] ?? c.field).join(' and ')} while you were editing. The task now shows their version.
        </Notice>
      )}

      <label className="sr-only" htmlFor="task-title">
        Title
      </label>
      <input
        id="task-title"
        className="task-title-input"
        value={title}
        maxLength={200}
        onFocus={() => beginEdit('title')}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const v = title.trim();
          if (!v) {
            setTitle(task.title);
            delete editingBase.current.title;
            return;
          }
          saveField('title', v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />

      <Segmented<TaskStatus> label="Status" value={task.status} options={STATUSES} onChange={(v) => saveField('status', v)} size="sm" />

      <div className="task-fields">
        <Field label="Assignees" htmlFor="task-assignees">
          <MemberPicker id="task-assignees" label="Assignees" members={members} value={task.assigneeIds} onChange={(ids) => saveField('assigneeIds', ids)} />
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <select id="task-priority" className="select" value={task.priority} onChange={(e) => saveField('priority', e.target.value as Priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Due date" htmlFor="task-due">
          <input id="task-due" type="date" className="input" value={task.dueDate ?? ''} onChange={(e) => saveField('dueDate', e.target.value || null)} />
        </Field>
        <Field label="Time" htmlFor="task-time" optional>
          <input id="task-time" type="time" className="input" value={task.dueTime ?? ''} disabled={!task.dueDate} onChange={(e) => saveField('dueTime', e.target.value || null)} />
        </Field>
        <Field label="Project" htmlFor="task-project" className="span-2">
          <select id="task-project" className="select" value={task.projectId ?? ''} onChange={(e) => saveField('projectId', e.target.value || null)}>
            <option value="">No project</option>
            {projects
              .filter((p) => p.status !== 'archived' || p.id === task.projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.clientName ? ` — ${p.clientName}` : ''}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <Field label="Description" htmlFor="task-desc">
        <textarea
          id="task-desc"
          className="textarea"
          rows={4}
          value={description}
          maxLength={8000}
          placeholder="Add details, links or acceptance notes…"
          onFocus={() => beginEdit('description')}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => saveField('description', description)}
        />
      </Field>

      <Checklist task={task} />
      <Comments task={task} />

      <section className="task-section">
        <h3 className="task-section-title">
          <Icon name="history" size={16} /> History
        </h3>
        <ul className="history">
          {task.history.map((h) => {
            const who = members.find((m) => m.id === h.actorId);
            return (
              <li key={h.id}>
                <span className="history-who">{who?.name ?? 'Someone'}</span> {h.summary}
                <time className="history-time" dateTime={h.createdAt}>
                  {relativeTime(h.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Checklist({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.task(task.id) });
    void qc.invalidateQueries({ queryKey: keys.tasks });
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (err) {
      toast({ tone: 'error', message: `Not saved: ${errorMessage(err)}` });
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setBusy(true);
    await run(() => api.post(`/tasks/${task.id}/checklist`, { title }));
    setDraft('');
    setBusy(false);
  };
  const done = task.items.filter((i) => i.done).length;
  return (
    <section className="task-section">
      <div className="task-section-head">
        <h3 className="task-section-title">
          <Icon name="checklist" size={16} /> Checklist
          {task.items.length > 0 && (
            <span className="muted-sm">
              {done}/{task.items.length}
            </span>
          )}
        </h3>
        <label className="sr-only" htmlFor="checklist-template">
          Add a starter checklist
        </label>
        <select
          id="checklist-template"
          className="select select-sm"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) void run(() => api.post(`/tasks/${task.id}/checklist/template`, { templateId: id }));
          }}
        >
          <option value="">Add starter checklist…</option>
          {CHECKLIST_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.items.length})
            </option>
          ))}
        </select>
      </div>
      {task.items.length > 0 && (
        <div className="progress-thin" aria-hidden="true">
          <span style={{ width: `${(done / task.items.length) * 100}%` }} />
        </div>
      )}
      <ul className="checklist">
        {task.items.map((item: ChecklistItem) => (
          <li key={item.id} className={item.done ? 'is-done' : ''}>
            <Checkbox checked={item.done} onChange={(v) => void run(() => api.patch(`/tasks/${task.id}/checklist/${item.id}`, { done: v }))} label={<span className="sr-only">{item.title}</span>} />
            {editing === item.id ? (
              <input
                className="input input-sm"
                defaultValue={item.title}
                autoFocus
                maxLength={200}
                aria-label="Checklist item"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  setEditing(null);
                  if (v && v !== item.title) void run(() => api.patch(`/tasks/${task.id}/checklist/${item.id}`, { title: v }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button type="button" className="checklist-text" onClick={() => setEditing(item.id)} title="Rename">
                {item.title}
              </button>
            )}
            <IconButton icon="x" size="sm" label={`Remove ${item.title}`} onClick={() => void run(() => api.del(`/tasks/${task.id}/checklist/${item.id}`))} />
          </li>
        ))}
      </ul>
      <form className="inline-add" onSubmit={add}>
        <label className="sr-only" htmlFor="checklist-new">
          New checklist item
        </label>
        <input id="checklist-new" className="input" placeholder="Add a subtask…" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} />
        <Button type="submit" variant="secondary" size="sm" icon="plus" loading={busy} disabled={!draft.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

function Comments({ task }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMeData();
  const members = useMembers().data ?? [];
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.task(task.id) });
    void qc.invalidateQueries({ queryKey: keys.tasks });
  };
  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/comments`, { body: body.trim() });
      setBody('');
      refresh();
    } catch (err) {
      toast({ tone: 'error', message: `Comment not posted: ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="task-section">
      <h3 className="task-section-title">
        <Icon name="chat" size={16} /> Comments
      </h3>
      {task.comments.length === 0 && <p className="muted-sm">No comments yet. Use comments for decisions and handoffs so they stay with the task.</p>}
      <ul className="comments">
        {task.comments.map((c) => {
          const author = members.find((m) => m.id === c.authorId);
          const mine = c.authorId === me.user.id;
          return (
            <li key={c.id} className="comment">
              <Avatar member={author ?? { id: c.authorId ?? 'x', name: 'Former member', avatarUrl: null }} size={28} />
              <div className="comment-body">
                <p className="comment-head">
                  <strong>{author?.name ?? 'Former member'}</strong>
                  <time dateTime={c.createdAt}>{relativeTime(c.createdAt)}</time>
                  {c.editedAt && <span className="muted-sm">edited</span>}
                </p>
                {editing?.id === c.id ? (
                  <form
                    className="comment-edit"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await api.patch(`/tasks/${task.id}/comments/${c.id}`, { body: editing.body });
                        setEditing(null);
                        refresh();
                      } catch (err) {
                        toast({ tone: 'error', message: errorMessage(err) });
                      }
                    }}
                  >
                    <textarea className="textarea" value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} aria-label="Edit comment" autoFocus />
                    <div className="row-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="primary" type="submit">
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="comment-text">{c.body}</p>
                )}
              </div>
              {(mine || can(me, 'tasks.deleteAny')) && editing?.id !== c.id && (
                <Menu
                  label="Comment actions"
                  items={[
                    ...(mine ? [{ label: 'Edit', icon: 'edit' as const, onSelect: () => setEditing({ id: c.id, body: c.body }) }] : []),
                    {
                      label: 'Delete',
                      icon: 'trash' as const,
                      danger: true,
                      onSelect: async () => {
                        try {
                          await api.del(`/tasks/${task.id}/comments/${c.id}`);
                          refresh();
                        } catch (err) {
                          toast({ tone: 'error', message: errorMessage(err) });
                        }
                      },
                    },
                  ]}
                />
              )}
            </li>
          );
        })}
      </ul>
      <form className="comment-form" onSubmit={post}>
        <label className="sr-only" htmlFor="comment-new">
          Write a comment
        </label>
        <textarea
          id="comment-new"
          className="textarea"
          rows={2}
          placeholder="Write a comment…"
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post(e);
          }}
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!body.trim()}>
          Comment
        </Button>
      </form>
    </section>
  );
}
