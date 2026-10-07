import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Field, Notice, describedBy } from '../../components/ui.tsx';
import { MemberPicker } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateWork, useMembers, useProjects } from '../../lib/queries.ts';
import { newKey } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { STATUSES } from './taskUtils.ts';
import { CHECKLIST_TEMPLATES } from '../../../shared/templates.ts';
import type { Priority, Task, TaskStatus } from '../../../shared/types.ts';

export function TaskCreateDialog() {
  const ui = useUI();
  return (
    <Dialog open={ui.newTask !== null} onClose={ui.closeNewTask} title="New task" size="md">
      {ui.newTask && <TaskForm key={JSON.stringify(ui.newTask)} />}
    </Dialog>
  );
}

function TaskForm() {
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers().data ?? [];
  const projects = (useProjects().data ?? []).filter((p) => p.status !== 'archived' && p.status !== 'completed');
  const d = ui.newTask ?? {};
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(d.status ?? 'todo');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState(d.dueDate ?? '');
  const [dueTime, setDueTime] = useState('');
  const [projectId, setProjectId] = useState(d.projectId ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(d.assigneeIds ?? []);
  const [template, setTemplate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);

  useEffect(() => setFormError(null), [title]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErrors({ title: 'Give the task a title.' });
    setErrors({});
    setBusy(true);
    try {
      const res = await api.post<{ task: Task; duplicate: boolean }>('/tasks', {
        title: title.trim(),
        description,
        status,
        priority,
        dueDate: dueDate || null,
        dueTime: dueDate && dueTime ? dueTime : null,
        projectId: projectId || null,
        assigneeIds,
        checklist: CHECKLIST_TEMPLATES.find((t) => t.id === template)?.items ?? [],
        idempotencyKey: key,
      });
      invalidateWork(qc);
      ui.closeNewTask();
      toast({ tone: 'success', message: `Created “${res.task.title}”`, action: { label: 'Open', onClick: () => ui.openTask(res.task.id) } });
    } catch (err) {
      if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label="Title" htmlFor="nt-title" error={errors.title}>
        <input id="nt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-autofocus aria-invalid={Boolean(errors.title) || undefined} aria-describedby={describedBy('nt-title', errors.title)} placeholder="e.g. Send homepage wireframes to Harbor" />
      </Field>
      <div className="form-row">
        <Field label="Due date" htmlFor="nt-due" optional>
          <input id="nt-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor="nt-time" optional>
          <input id="nt-time" type="time" className="input" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Status" htmlFor="nt-status">
          <select id="nt-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" htmlFor="nt-priority">
          <select id="nt-priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
      </div>
      <Field label="Assignees" htmlFor="nt-assignees" error={errors.assigneeIds}>
        <MemberPicker id="nt-assignees" label="Assignees" members={members} value={assigneeIds} onChange={setAssigneeIds} />
      </Field>
      <Field label="Project" htmlFor="nt-project" optional error={errors.projectId}>
        <select id="nt-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.clientName ? ` — ${p.clientName}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description" htmlFor="nt-desc" optional>
        <textarea id="nt-desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} />
      </Field>
      <Field label="Starter checklist" htmlFor="nt-template" optional hint="Adds a ready-made list of subtasks you can edit later.">
        <select id="nt-template" className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">None</option>
          {CHECKLIST_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.items.length} items)
            </option>
          ))}
        </select>
      </Field>
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="form-actions">
        <Button variant="ghost" onClick={ui.closeNewTask}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Create task
        </Button>
      </div>
    </form>
  );
}
