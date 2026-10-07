import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Avatar, Button, EmptyState, Notice, Segmented, Skeleton } from '../../components/ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { errorMessage } from '../../lib/api.ts';
import { useMembers, useProjects } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { PROJECT_STATUS } from './ProjectEditor.tsx';
import { STAGES } from '../../../shared/templates.ts';
import { formatISO, todayIn } from '../../../shared/dates.ts';
import type { Project } from '../../../shared/types.ts';

export function StagePips({ stage }: { stage: Project['stage'] }) {
  const idx = STAGES.findIndex((s) => s.value === stage);
  return (
    <span className="stage-pips" role="img" aria-label={`Stage ${idx + 1} of ${STAGES.length}: ${STAGES[idx]?.label}`}>
      {STAGES.map((s, i) => (
        <span key={s.value} className={i < idx ? 'is-past' : i === idx ? 'is-now' : ''} />
      ))}
    </span>
  );
}

export function ProjectCard({ p }: { p: Project }) {
  const me = useMeData();
  const members = useMembers().data ?? [];
  const lead = members.find((m) => m.id === p.leadId);
  const today = todayIn(tzOf(me));
  const pct = p.taskCounts.total ? Math.round((p.taskCounts.done / p.taskCounts.total) * 100) : 0;
  const late = p.dueDate && p.dueDate < today && p.status !== 'completed';
  return (
    <Link to={`/app/projects/${p.id}`} className={`project-card c-${p.color}`}>
      <div className="project-card-top">
        <span className="project-swatch" aria-hidden="true" />
        <span className="mono-label">{p.clientName ?? 'Internal'}</span>
        {p.status !== 'active' && <span className="tag">{PROJECT_STATUS.find((s) => s.value === p.status)?.label}</span>}
      </div>
      <h3 className="project-card-name">{p.name}</h3>
      <div className="project-card-stage">
        <StagePips stage={p.stage} />
        <span>{STAGES.find((s) => s.value === p.stage)?.label}</span>
      </div>
      <div className="project-progress" aria-label={`${p.taskCounts.done} of ${p.taskCounts.total} tasks complete`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="project-card-meta">
        <span>
          {p.taskCounts.done}/{p.taskCounts.total} tasks{p.taskCounts.overdue ? <span className="due-overdue"> · {p.taskCounts.overdue} overdue</span> : null}
        </span>
        {p.dueDate && <span className={late ? 'due-overdue' : ''}>Due {formatISO(p.dueDate, { month: 'short', day: 'numeric' })}</span>}
        {lead && <Avatar member={lead} size={22} />}
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const ui = useUI();
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const q = useProjects(filter === 'open' ? 'planned,active,on_hold' : filter === 'completed' ? 'completed,archived' : undefined);
  useEffect(() => {
    document.title = 'Projects · Lumera Creative';
  }, []);
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Delivery</p>
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="page-actions">
          <Segmented
            label="Show"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'In progress' },
              { value: 'completed', label: 'Finished' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Button variant="primary" icon="plus" onClick={() => ui.openProjectEditor()}>
            New project
          </Button>
        </div>
      </header>
      {q.isError && <Notice tone="danger">{errorMessage(q.error)}</Notice>}
      {q.isPending ? (
        <div className="project-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="project-card">
              <Skeleton h={14} w="40%" />
              <Skeleton h={22} />
              <Skeleton h={6} />
            </div>
          ))}
        </div>
      ) : q.data!.length === 0 ? (
        <div className="card">
          <EmptyState icon="projects" title={filter === 'open' ? 'No projects in progress' : 'Nothing here yet'} action={<Button variant="secondary" icon="plus" onClick={() => ui.openProjectEditor()}>Create your first project</Button>}>
            Projects group a client’s tasks, meetings and profit. Choose starter tasks for discovery, design, development, review, launch or ongoing marketing when you create one.
          </EmptyState>
        </div>
      ) : (
        <div className="project-grid">
          {q.data!.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <p className="fine-print">
        <Icon name="info" size={13} /> Archive projects you’re done with — their tasks and history stay available.
      </p>
    </div>
  );
}
