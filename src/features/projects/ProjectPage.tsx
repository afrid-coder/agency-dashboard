import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, EmptyState, Menu, Notice, Skeleton } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon, LumeMark } from '../../lib/icons.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { invalidateWork, useMembers, useProject, useTasks } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { TaskRow } from '../tasks/TaskRow.tsx';
import { PROJECT_STATUS } from './ProjectEditor.tsx';
import { STAGES } from '../../../shared/templates.ts';
import { formatISO, formatInstant, todayIn } from '../../../shared/dates.ts';
import { formatCents } from '../../../shared/money.ts';
import type { Stage } from '../../../shared/types.ts';

export function ProjectPage() {
  const { id = '' } = useParams();
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const tz = tzOf(me);
  const today = todayIn(tz);
  const q = useProject(id);
  const members = useMembers().data ?? [];
  const [showDone, setShowDone] = useState(false);
  const tasks = useTasks({ view: showDone ? 'completed' : 'team', projectId: id, limit: 200 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) document.title = `${q.data.name} · Lumera Creative`;
  }, [q.data]);

  if (q.isPending)
    return (
      <div className="page">
        <Skeleton h={40} w="50%" />
        <Skeleton h={120} />
      </div>
    );
  if (q.isError)
    return (
      <div className="page">
        <EmptyState icon="projects" title="Project not found" action={<Link to="/app/projects" className="btn btn-secondary btn-md">All projects</Link>}>
          {errorMessage(q.error)}
        </EmptyState>
      </div>
    );
  const p = q.data;
  const lead = members.find((m) => m.id === p.leadId);
  const stageIdx = STAGES.findIndex((s) => s.value === p.stage);

  const setStage = async (stage: Stage) => {
    try {
      await api.patch(`/projects/${p.id}`, { changes: { stage }, base: { stage: p.stage } });
      invalidateWork(qc);
      toast({ tone: 'success', message: `Moved to ${STAGES.find((s) => s.value === stage)?.label}` });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };
  const setStatus = async (status: string) => {
    try {
      await api.patch(`/projects/${p.id}`, { changes: { status }, base: { status: p.status } });
      invalidateWork(qc);
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/projects/${p.id}`);
      invalidateWork(qc);
      navigate('/app/projects');
      toast({ tone: 'info', message: `Deleted ${p.name}` });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/app/projects">Projects</Link>
        <Icon name="right" size={14} />
        <span aria-current="page">{p.name}</span>
      </nav>
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">{p.clientName ?? 'Internal project'}</p>
          <h1 className="page-title">{p.name}</h1>
          <p className="page-subtitle">
            {PROJECT_STATUS.find((s) => s.value === p.status)?.label}
            {p.startDate && ` · Started ${formatISO(p.startDate, { month: 'short', day: 'numeric' })}`}
            {p.dueDate && ` · Due ${formatISO(p.dueDate, { month: 'short', day: 'numeric', year: 'numeric' })}`}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" leading={<LumeMark size={16} />} onClick={() => ui.openLume(`What are the most practical next steps for the ${p.name} project?`)}>
            Next steps
          </Button>
          <Button variant="secondary" icon="edit" onClick={() => ui.openProjectEditor(p)}>
            Edit
          </Button>
          <Menu
            label="Project actions"
            items={[
              ...PROJECT_STATUS.filter((s) => s.value !== p.status).map((s) => ({ label: `Mark ${s.label.toLowerCase()}`, icon: 'flag' as const, onSelect: () => void setStatus(s.value) })),
              ...(can(me, 'projects.delete') ? [{ label: 'Delete project', icon: 'trash' as const, danger: true, onSelect: () => setConfirmDelete(true) }] : []),
            ]}
          />
        </div>
      </header>

      <section className="card pipeline" aria-label="Stage">
        <ol className="pipeline-steps">
          {STAGES.map((s, i) => (
            <li key={s.value} className={i < stageIdx ? 'is-past' : i === stageIdx ? 'is-now' : ''}>
              <button type="button" onClick={() => i !== stageIdx && void setStage(s.value)} aria-current={i === stageIdx ? 'step' : undefined} title={s.summary}>
                <span className="pipeline-dot" aria-hidden="true" />
                <span className="pipeline-label">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="muted-sm pipeline-note">{STAGES[stageIdx]?.summary}</p>
      </section>

      <div className="project-layout">
        <section className="card" aria-labelledby="pt-title">
          <div className="card-header">
            <h2 className="card-title" id="pt-title">
              <Icon name="tasks" size={18} /> Tasks
              <span className="muted-sm">
                {p.taskCounts.done}/{p.taskCounts.total} done
              </span>
            </h2>
            <div className="row-gap">
              <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)} aria-pressed={showDone}>
                {showDone ? 'Show open' : 'Show completed'}
              </Button>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openNewTask({ projectId: p.id, assigneeIds: p.leadId ? [p.leadId] : [] })}>
                Task
              </Button>
            </div>
          </div>
          <div className="card-body list-flush">
            {tasks.isPending && <Skeleton h={40} />}
            {tasks.data?.items.length === 0 && (
              <EmptyState icon="tasks" title={showDone ? 'Nothing completed yet' : 'No open tasks'}>
                {showDone ? 'Completed tasks will appear here.' : 'Add tasks, or ask Lume to draft a task list for this stage.'}
              </EmptyState>
            )}
            {tasks.data?.items.map((t) => (
              <TaskRow key={t.id} task={t} today={today} showProject={false} />
            ))}
          </div>
        </section>

        <aside className="stack-lg">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Details</h2>
            </div>
            <dl className="details">
              <dt>Client</dt>
              <dd>{p.clientName ? <Link to={`/app/clients?client=${p.clientId}`}>{p.clientName}</Link> : 'Internal'}</dd>
              <dt>Lead</dt>
              <dd>
                {lead ? (
                  <span className="row-gap">
                    <Avatar member={lead} size={22} /> {lead.name}
                  </span>
                ) : (
                  'No lead'
                )}
              </dd>
              {p.profitCents !== null && (
                <>
                  <dt>Recorded profit</dt>
                  <dd>
                    <span className="mono-num">{formatCents(p.profitCents)}</span>
                    {can(me, 'finance.record') && (
                      <button type="button" className="link-btn" onClick={() => ui.openProfitEditor(null, p.id)}>
                        Add profit
                      </button>
                    )}
                  </dd>
                </>
              )}
            </dl>
            {p.description && <p className="project-desc">{p.description}</p>}
          </section>
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Icon name="calendar" size={18} /> Upcoming
              </h2>
              <Button size="sm" variant="ghost" icon="calendarAdd" onClick={() => ui.openNewEvent({ projectId: p.id })}>
                Event
              </Button>
            </div>
            <div className="card-body">
              {p.upcomingEvents.length === 0 ? (
                <p className="muted-sm">No meetings scheduled for this project in the next six weeks.</p>
              ) : (
                <ul className="mini-list">
                  {p.upcomingEvents.map((o) => (
                    <li key={o.key}>
                      <button type="button" className="mini-item" onClick={() => ui.showEvent(o)}>
                        <span className="mini-date">{o.allDay ? formatISO(o.startDate!, { month: 'short', day: 'numeric' }) : formatInstant(o.startsAt!, tz, { month: 'short', day: 'numeric' })}</span>
                        <span className="mini-title">{o.title}</span>
                        <span className="muted-sm">{o.allDay ? 'All day' : formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog open={confirmDelete} title={`Delete ${p.name}?`} confirmLabel="Delete project" busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={() => void remove()}>
        The project is removed permanently. Its tasks, events and profit entries are kept but no longer linked to a project. To keep everything together, mark it archived instead.
      </ConfirmDialog>
      {p.status === 'archived' && <Notice tone="info">This project is archived.</Notice>}
    </div>
  );
}
