// Preview of a change Lume proposed. Nothing is saved until Confirm.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Notice } from '../../components/ui.tsx';
import { MemberPicker } from '../../components/extras.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateEvents, invalidateWork, useMembers, useProjects } from '../../lib/queries.ts';
import { STATUS_LABEL } from '../../lib/format.ts';
import { formatTime12 } from '../tasks/taskUtils.ts';
import { RecordChip } from './LumeText.tsx';
import { formatISO } from '../../../shared/dates.ts';
import type { ActionPayload, LumeAction, ProposedEvent, ProposedTask } from '../../../shared/types.ts';

const TITLE: Record<LumeAction['kind'], string> = {
  create_task: 'New task',
  create_tasks: 'Task list',
  update_task: 'Update task',
  create_event: 'New event',
};

const day = (d?: string | null) => (d ? formatISO(d, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date');

export function ActionCard({ action, onChange }: { action: LumeAction; onChange: (a: LumeAction) => void }) {
  const qc = useQueryClient();
  const members = useMembers().data ?? [];
  const projects = useProjects().data ?? [];
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ActionPayload>(action.payload);
  const names = (ids?: string[]) => (ids ?? []).map((id) => members.find((m) => m.id === id)?.name.split(' ')[0] ?? 'someone').join(', ');
  const projectName = (id?: string | null) => projects.find((p) => p.id === id)?.name;

  const confirm = async (force = false) => {
    setBusy('confirm');
    setError(null);
    try {
      const updated = await api.post<LumeAction>(`/lume/actions/${action.id}/confirm`, { payload: editing || JSON.stringify(draft) !== JSON.stringify(action.payload) ? draft : undefined, force });
      onChange(updated);
      setEditing(false);
      invalidateWork(qc);
      invalidateEvents(qc);
    } catch (err) {
      setError({ message: errorMessage(err), conflict: err instanceof ApiRequestError && err.code === 'conflict' });
      onChange({ ...action, status: 'failed' });
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      onChange(await api.post<LumeAction>(`/lume/actions/${action.id}/cancel`));
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const done = action.status === 'confirmed';
  const cancelled = action.status === 'cancelled';
  const p = done || cancelled ? action.payload : draft;

  return (
    <div className={`action-card is-${action.status}`} role="group" aria-label={`Proposed: ${TITLE[action.kind]}`}>
      <div className="action-head">
        <span className="action-kind">
          <Icon name={action.kind === 'create_event' ? 'calendarAdd' : action.kind === 'update_task' ? 'edit' : 'tasks'} size={15} />
          {TITLE[action.kind]}
        </span>
        <span className={`action-status s-${action.status}`}>{done ? 'Saved' : cancelled ? 'Cancelled' : action.status === 'failed' ? 'Not saved' : 'Needs your confirmation'}</span>
      </div>

      {editing ? (
        <ActionEditor payload={draft} onChange={setDraft} />
      ) : (
        <div className="action-body">
          {p.kind === 'create_task' && <TaskSummary t={p.task} names={names} projectName={projectName} />}
          {p.kind === 'create_tasks' && (
            <>
              {p.projectId && <p className="action-meta">For {projectName(p.projectId) ?? 'the project'}</p>}
              <ol className="action-list">
                {p.tasks.map((t, i) => (
                  <li key={i}>
                    {t.title}
                    {t.dueDate && <span className="muted-sm"> · {day(t.dueDate)}</span>}
                    {t.checklist?.length ? <span className="muted-sm"> · {t.checklist.length} checklist items</span> : null}
                  </li>
                ))}
              </ol>
            </>
          )}
          {p.kind === 'update_task' && (
            <>
              <p className="action-title">{p.update.taskTitle}</p>
              <ul className="action-changes">
                {p.update.status && (
                  <li>
                    Status: <s>{STATUS_LABEL[p.update.base.status as keyof typeof STATUS_LABEL] ?? '—'}</s> → <strong>{STATUS_LABEL[p.update.status]}</strong>
                  </li>
                )}
                {p.update.dueDate !== undefined && (
                  <li>
                    Due: <s>{day(p.update.base.dueDate)}</s> → <strong>{day(p.update.dueDate)}</strong>
                  </li>
                )}
                {p.update.priority && (
                  <li>
                    Priority: <s>{p.update.base.priority}</s> → <strong>{p.update.priority}</strong>
                  </li>
                )}
                {p.update.assigneeIds && (
                  <li>
                    Assignees: <strong>{names(p.update.assigneeIds) || 'Unassigned'}</strong>
                  </li>
                )}
              </ul>
            </>
          )}
          {p.kind === 'create_event' && <EventSummary e={p.event} names={names} projectName={projectName} />}
        </div>
      )}

      {action.warnings.length > 0 && !done && !cancelled && (
        <ul className="action-warnings">
          {action.warnings.map((w, i) => (
            <li key={i}>
              <Icon name="warning" size={14} /> {w.message}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Notice tone="danger" action={error.conflict ? <Button size="sm" variant="secondary" onClick={() => void confirm(true)}>Apply anyway</Button> : undefined}>
          {error.conflict ? 'This task changed after Lume suggested the update. Review it, or apply the change anyway.' : error.message}
        </Notice>
      )}

      {done && action.result && (
        <div className="action-result">
          <Icon name="checkFilled" size={15} />
          <span>{action.result.message}</span>
          <span className="action-links">
            {action.result.refs.slice(0, 4).map((r) => (
              <RecordChip key={r.id} r={r} />
            ))}
            {action.result.refs.length > 4 && <span className="muted-sm">+{action.result.refs.length - 4} more</span>}
          </span>
        </div>
      )}

      {!done && !cancelled && (
        <div className="action-buttons">
          <Button size="sm" variant="primary" icon="check" onClick={() => void confirm()} loading={busy === 'confirm'} disabled={busy !== null}>
            Confirm
          </Button>
          <Button size="sm" variant="secondary" icon={editing ? 'eye' : 'edit'} onClick={() => setEditing((v) => !v)} disabled={busy !== null}>
            {editing ? 'Preview' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void cancel()} loading={busy === 'cancel'} disabled={busy !== null}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function TaskSummary({ t, names, projectName }: { t: ProposedTask; names: (ids?: string[]) => string; projectName: (id?: string | null) => string | undefined }) {
  return (
    <>
      <p className="action-title">{t.title}</p>
      <dl className="action-fields">
        <dt>Due</dt>
        <dd>
          {day(t.dueDate)}
          {t.dueTime ? ` · ${formatTime12(t.dueTime)}` : ''}
        </dd>
        <dt>Priority</dt>
        <dd className="cap">{t.priority ?? 'medium'}</dd>
        <dt>Assignees</dt>
        <dd>{names(t.assigneeIds) || 'Unassigned'}</dd>
        {t.projectId && (
          <>
            <dt>Project</dt>
            <dd>{projectName(t.projectId) ?? '—'}</dd>
          </>
        )}
        {t.checklist?.length ? (
          <>
            <dt>Checklist</dt>
            <dd>{t.checklist.length} items</dd>
          </>
        ) : null}
      </dl>
    </>
  );
}

function EventSummary({ e, names, projectName }: { e: ProposedEvent; names: (ids?: string[]) => string; projectName: (id?: string | null) => string | undefined }) {
  return (
    <>
      <p className="action-title">{e.title}</p>
      <dl className="action-fields">
        <dt>When</dt>
        <dd>
          {day(e.date)}
          {e.allDay ? ' · All day' : ` · ${formatTime12(e.startTime!)}–${formatTime12(e.endTime!)}`}
        </dd>
        <dt>People</dt>
        <dd>{names(e.attendeeIds) || 'Just you'}</dd>
        {e.projectId && (
          <>
            <dt>Project</dt>
            <dd>{projectName(e.projectId)}</dd>
          </>
        )}
        {e.location && (
          <>
            <dt>Where</dt>
            <dd>{e.location}</dd>
          </>
        )}
      </dl>
    </>
  );
}

function ActionEditor({ payload, onChange }: { payload: ActionPayload; onChange: (p: ActionPayload) => void }) {
  const members = useMembers().data ?? [];
  const projects = (useProjects().data ?? []).filter((p) => p.status !== 'archived');
  if (payload.kind === 'create_task') {
    const t = payload.task;
    const set = (patch: Partial<ProposedTask>) => onChange({ ...payload, task: { ...t, ...patch } });
    return (
      <div className="action-edit form-grid">
        <Field label="Title" htmlFor="ae-title">
          <input id="ae-title" className="input" value={t.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
        </Field>
        <div className="form-row">
          <Field label="Due" htmlFor="ae-due">
            <input id="ae-due" type="date" className="input" value={t.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
          </Field>
          <Field label="Priority" htmlFor="ae-pri">
            <select id="ae-pri" className="select" value={t.priority ?? 'medium'} onChange={(e) => set({ priority: e.target.value as ProposedTask['priority'] })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
        </div>
        <Field label="Assignees" htmlFor="ae-people">
          <MemberPicker id="ae-people" label="Assignees" members={members} value={t.assigneeIds ?? []} onChange={(ids) => set({ assigneeIds: ids })} />
        </Field>
        <Field label="Project" htmlFor="ae-proj">
          <select id="ae-proj" className="select" value={t.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    );
  }
  if (payload.kind === 'create_tasks')
    return (
      <div className="action-edit form-grid">
        {payload.tasks.map((t, i) => (
          <div key={i} className="action-edit-row">
            <label className="sr-only" htmlFor={`ae-t${i}`}>
              Task {i + 1}
            </label>
            <input id={`ae-t${i}`} className="input" value={t.title} maxLength={200} onChange={(e) => onChange({ ...payload, tasks: payload.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <input type="date" className="input input-date" aria-label={`Due date for task ${i + 1}`} value={t.dueDate ?? ''} onChange={(e) => onChange({ ...payload, tasks: payload.tasks.map((x, j) => (j === i ? { ...x, dueDate: e.target.value || null } : x)) })} />
            <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Remove ${t.title}`} disabled={payload.tasks.length === 1} onClick={() => onChange({ ...payload, tasks: payload.tasks.filter((_, j) => j !== i) })}>
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
      </div>
    );
  if (payload.kind === 'update_task') {
    const u = payload.update;
    const set = (patch: Partial<typeof u>) => onChange({ ...payload, update: { ...u, ...patch } });
    return (
      <div className="action-edit form-grid">
        <p className="action-title">{u.taskTitle}</p>
        <div className="form-row">
          <Field label="Status" htmlFor="ae-status">
            <select id="ae-status" className="select" value={u.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as typeof u.status })}>
              <option value="">Keep current</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due" htmlFor="ae-udue">
            <input id="ae-udue" type="date" className="input" value={u.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
          </Field>
        </div>
      </div>
    );
  }
  const ev = payload.event;
  const set = (patch: Partial<ProposedEvent>) => onChange({ ...payload, event: { ...ev, ...patch } });
  return (
    <div className="action-edit form-grid">
      <Field label="Title" htmlFor="ae-etitle">
        <input id="ae-etitle" className="input" value={ev.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
      </Field>
      <div className="form-row form-row-3">
        <Field label="Date" htmlFor="ae-edate">
          <input id="ae-edate" type="date" className="input" value={ev.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        {!ev.allDay && (
          <>
            <Field label="Starts" htmlFor="ae-estart">
              <input id="ae-estart" type="time" className="input" value={ev.startTime ?? ''} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="Ends" htmlFor="ae-eend">
              <input id="ae-eend" type="time" className="input" value={ev.endTime ?? ''} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      <Field label="People" htmlFor="ae-epeople">
        <MemberPicker id="ae-epeople" label="Attendees" members={members} value={ev.attendeeIds ?? []} onChange={(ids) => set({ attendeeIds: ids })} placeholder="Just you" />
      </Field>
    </div>
  );
}
