import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { Avatar, Button, EmptyState, Skeleton } from '../../components/ui.tsx';
import { Icon } from "../../lib/icons.tsx";
import { revealChildren } from '../../lib/motion.ts';
import { relativeTime } from '../../lib/format.ts';
import { useActivity, useEvents, useMembers, useNotes, useProjects, useTasks } from '../../lib/queries.ts';
import { AddedBy } from '../../components/AddedBy.tsx';
import { NoteCard } from '../notes/NotesPage.tsx';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { BriefingCard } from '../lume/BriefingCard.tsx';
import { GoalCard } from '../profit/GoalCard.tsx';
import { TaskRow } from '../tasks/TaskRow.tsx';
import { ProjectCard } from '../projects/ProjectsPage.tsx';
import { addDays, dateInZone, formatISO, formatInstant, greetingFor, hourIn, todayIn } from '../../../shared/dates.ts';
import { formatTime12 } from '../tasks/taskUtils.ts';

export function DashboardPage() {
  const me = useMeData();
  const ui = useUI();
  const tz = tzOf(me);
  const today = todayIn(tz);
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `Dashboard · ${me.workspace!.name}`;
    revealChildren(scope.current, { stagger: 0.05 });
  }, [me.workspace]);

  return (
    <div className="page dashboard" ref={scope}>
      <header className="hello" data-reveal>
        <div>
          <p className="mono-label">{formatISO(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1 className="hello-title">
            {greetingFor(hourIn(tz))}, <em>{me.user.name.split(' ')[0]}.</em>
          </h1>
        </div>
        <div className="quick-actions" role="group" aria-label="Quick actions">
          <Button variant="secondary" size="sm" icon="tasks" onClick={() => ui.openNewTask({ assigneeIds: [me.user.id], dueDate: today })}>
            Task
          </Button>
          <Button variant="secondary" size="sm" icon="calendarAdd" onClick={() => ui.openNewEvent({ date: today })}>
            Event
          </Button>
          <Button variant="secondary" size="sm" icon="notes" onClick={() => ui.openNote()}>
            Note
          </Button>
          <Button variant="secondary" size="sm" icon="projects" onClick={() => ui.openProjectEditor()}>
            Project
          </Button>
          {can(me, 'finance.record') && (
            <Button variant="secondary" size="sm" icon="profit" onClick={() => ui.openProfitEditor()}>
              Profit
            </Button>
          )}
        </div>
      </header>

      <div className="dash-grid">
        <div className="dash-main">
          <div data-reveal>
            <BriefingCard />
          </div>
          <div data-reveal>
            <TodayAgenda />
          </div>
          <div data-reveal>
            <TeamNotes />
          </div>
          <div data-reveal>
            <MyPriorities />
          </div>
          <div data-reveal>
            <ActiveProjects />
          </div>
        </div>
        <div className="dash-side">
          {can(me, 'finance.viewSummary') && (
            <div data-reveal>
              <GoalCard compact />
            </div>
          )}
          <div data-reveal>
            <Upcoming />
          </div>
          <div data-reveal>
            <TeamLoad />
          </div>
          <div data-reveal>
            <Activity />
          </div>
        </div>
      </div>
    </div>
  );
}

function TodayAgenda() {
  const me = useMeData();
  const ui = useUI();
  const tz = tzOf(me);
  const today = todayIn(tz);
  const events = useEvents({ from: today, to: today, tz, scope: 'mine' });
  const tasks = useTasks({ view: 'mine', from: today, to: today, status: 'todo,in_progress,review,done' });
  const now = Date.now();
  const items = useMemo(() => {
    const evs = (events.data ?? []).map((o) => ({ key: o.key, at: o.allDay ? '00:00' : formatInstant(o.startsAt!, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), kind: 'event' as const, o }));
    const tks = (tasks.data?.items ?? []).map((t) => ({ key: t.id, at: t.dueTime ?? '23:59', kind: 'task' as const, t }));
    return [...evs, ...tks].sort((a, b) => a.at.localeCompare(b.at));
  }, [events.data, tasks.data, tz]);
  return (
    <section className="card" aria-labelledby="agenda-title">
      <div className="card-header">
        <h2 className="card-title" id="agenda-title">
          <Icon name="agenda" size={18} /> Today’s agenda
        </h2>
        <Link to="/app/calendar?view=day" className="btn btn-ghost btn-sm">
          Open day
        </Link>
      </div>
      <div className="card-body">
        {(events.isPending || tasks.isPending) && <Skeleton h={48} />}
        {!events.isPending && !tasks.isPending && items.length === 0 && (
          <EmptyState icon="calendar" title="A clear day" action={<Button size="sm" variant="secondary" icon="calendarAdd" onClick={() => ui.openNewEvent({ date: today })}>Schedule something</Button>}>
            No meetings or tasks due for you today.
          </EmptyState>
        )}
        <ol className="timeline">
          {items.map((it) =>
            it.kind === 'event' ? (
              <li key={it.key} className={`timeline-item is-event ${!it.o.allDay && new Date(it.o.endsAt!).getTime() < now ? 'is-past' : ''}`}>
                <span className="timeline-time">{it.o.allDay ? 'All day' : formatInstant(it.o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' })}</span>
                <button type="button" className="timeline-body" onClick={() => ui.showEvent(it.o)}>
                  <span className="timeline-title">{it.o.title}</span>
                  <span className="muted-sm timeline-sub">
                    {it.o.allDay ? 'All day' : `until ${formatInstant(it.o.endsAt!, tz, { hour: 'numeric', minute: '2-digit' })}`}
                    {it.o.location ? ` · ${it.o.location}` : ''}
                    <AddedBy userId={it.o.createdBy} showVerb />
                  </span>
                </button>
              </li>
            ) : (
              <li key={it.key} className={`timeline-item is-task ${it.t.status === 'done' ? 'is-past' : ''}`}>
                <span className="timeline-time">{it.t.dueTime ? formatTime12(it.t.dueTime) : 'Due'}</span>
                <button type="button" className="timeline-body" onClick={() => ui.openTask(it.t.id)}>
                  <span className="timeline-title">
                    {it.t.status === 'done' && <Icon name="checkFilled" size={14} />} {it.t.title}
                  </span>
                  <span className="muted-sm timeline-sub">
                    Task{it.t.projectName ? ` · ${it.t.projectName}` : ''}
                    <AddedBy userId={it.t.createdBy} showVerb />
                  </span>
                </button>
              </li>
            ),
          )}
        </ol>
      </div>
    </section>
  );
}

function TeamNotes() {
  const ui = useUI();
  const q = useNotes();
  const notes = q.data ?? [];
  return (
    <section className="card" aria-labelledby="notes-title">
      <div className="card-header">
        <h2 className="card-title" id="notes-title">
          <Icon name="notes" size={18} /> Team notes
        </h2>
        <Link to="/app/notes" className="btn btn-ghost btn-sm">
          All notes
        </Link>
      </div>
      <div className="card-body">
        {q.isPending && <Skeleton h={80} />}
        {q.data?.length === 0 && (
          <EmptyState icon="notes" title="No notes yet" action={<Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openNote()}>Write a note</Button>}>
            Notes you and your partner write show up here, with who wrote each one.
          </EmptyState>
        )}
        {notes.length > 0 && (
          <ul className="note-grid is-compact" aria-label="Latest notes">
            {notes.slice(0, 4).map((n) => (
              <li key={n.id}>
                <NoteCard note={n} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MyPriorities() {
  const me = useMeData();
  const ui = useUI();
  const today = todayIn(tzOf(me));
  const q = useTasks({ view: 'mine', limit: 8 });
  return (
    <section className="card" aria-labelledby="mine-title">
      <div className="card-header">
        <h2 className="card-title" id="mine-title">
          <Icon name="flag" size={18} /> Your priorities
        </h2>
        <Link to="/app/tasks" className="btn btn-ghost btn-sm">
          All tasks
        </Link>
      </div>
      <div className="card-body list-flush">
        {q.isPending && <Skeleton h={40} />}
        {q.data?.items.length === 0 && (
          <EmptyState icon="tasks" title="Nothing assigned to you" action={<Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openNewTask({ assigneeIds: [me.user.id] })}>Add your first task</Button>}>
            Tasks assigned to you appear here, soonest first.
          </EmptyState>
        )}
        {q.data?.items.map((t) => (
          <TaskRow key={t.id} task={t} today={today} compact />
        ))}
      </div>
    </section>
  );
}

function ActiveProjects() {
  const ui = useUI();
  const q = useProjects('active');
  return (
    <section className="card" aria-labelledby="proj-title">
      <div className="card-header">
        <h2 className="card-title" id="proj-title">
          <Icon name="projects" size={18} /> Active projects
        </h2>
        <Link to="/app/projects" className="btn btn-ghost btn-sm">
          All projects
        </Link>
      </div>
      <div className="card-body">
        {q.isPending && <Skeleton h={80} />}
        {q.data?.length === 0 && (
          <EmptyState icon="projects" title="No active projects" action={<Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openProjectEditor()}>Create a project</Button>}>
            Start with a client project and optional starter tasks for each stage.
          </EmptyState>
        )}
        <div className="project-grid is-compact">
          {q.data?.slice(0, 4).map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Upcoming() {
  const me = useMeData();
  const ui = useUI();
  const tz = tzOf(me);
  const today = todayIn(tz);
  const events = useEvents({ from: addDays(today, 1), to: addDays(today, 7), tz, scope: 'team' });
  const tasks = useTasks({ view: 'team', from: addDays(today, 1), to: addDays(today, 7), limit: 12 });
  const items = [
    ...(events.data ?? []).map((o) => ({ key: o.key, date: o.allDay ? o.startDate! : dateInZone(new Date(o.startsAt!), tz), label: o.title, sub: o.allDay ? 'All day' : formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' }), onClick: () => ui.showEvent(o), kind: 'event', by: o.createdBy })),
    ...(tasks.data?.items ?? []).map((t) => ({ key: t.id, date: t.dueDate!, label: t.title, sub: 'Deadline', onClick: () => ui.openTask(t.id), kind: 'task', by: t.createdBy })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="card" aria-labelledby="up-title">
      <div className="card-header">
        <h2 className="card-title" id="up-title">
          <Icon name="calendarMark" size={18} /> Next 7 days
        </h2>
      </div>
      <div className="card-body">
        {(events.isPending || tasks.isPending) && <Skeleton h={60} />}
        {items.length === 0 && !events.isPending && <p className="muted-sm">No meetings or deadlines in the next week.</p>}
        <ul className="mini-list">
          {items.slice(0, 8).map((it) => (
            <li key={it.key}>
              <button type="button" className="mini-item" onClick={it.onClick}>
                <span className="mini-date">{formatISO(it.date, { weekday: 'short', day: 'numeric' })}</span>
                <span className={`legend-${it.kind}`} aria-hidden="true" />
                <span className="mini-title">{it.label}</span>
                <AddedBy userId={it.by} variant="avatar" />
                <span className="muted-sm">{it.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TeamLoad() {
  const members = useMembers().data ?? [];
  const q = useTasks({ view: 'team', limit: 200 });
  const me = useMeData();
  const today = todayIn(tzOf(me));
  const rows = members
    .map((m) => {
      const mine = (q.data?.items ?? []).filter((t) => t.assigneeIds.includes(m.id));
      return { m, open: mine.length, overdue: mine.filter((t) => t.dueDate && t.dueDate < today).length };
    })
    .sort((a, b) => b.open - a.open);
  const max = Math.max(...rows.map((r) => r.open), 1);
  return (
    <section className="card" aria-labelledby="team-title">
      <div className="card-header">
        <h2 className="card-title" id="team-title">
          <Icon name="people" size={18} /> Team assignments
        </h2>
      </div>
      <div className="card-body">
        {q.isPending && <Skeleton h={60} />}
        <ul className="load-list">
          {rows.map(({ m, open, overdue }) => (
            <li key={m.id}>
              <Link to={`/app/tasks?view=team&assignee=${m.id}`} className="load-row">
                <Avatar member={m} size={26} />
                <span className="load-name">{m.name.split(' ')[0]}</span>
                <span className="load-bar" aria-hidden="true">
                  <span style={{ width: `${(open / max) * 100}%` }} />
                </span>
                <span className="load-count">
                  {open}
                  {overdue > 0 && <span className="due-overdue"> · {overdue} late</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {members.length <= 1 && can(me, 'members.invite') && (
          <Link to="/app/settings/members" className="btn btn-ghost btn-sm">
            <Icon name="invite" size={16} /> Invite your team
          </Link>
        )}
      </div>
    </section>
  );
}

function Activity() {
  const q = useActivity();
  const members = useMembers().data ?? [];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="card" aria-labelledby="act-title">
      <div className="card-header">
        <h2 className="card-title" id="act-title">
          <Icon name="history" size={18} /> Recent activity
        </h2>
      </div>
      <div className="card-body">
        {q.isPending && <Skeleton h={60} />}
        {items.length === 0 && !q.isPending && <p className="muted-sm">Changes by the team will show up here.</p>}
        <ul className="activity">
          {items.map((a) => {
            const who = members.find((m) => m.id === a.actorId);
            return (
              <li key={a.id}>
                <Avatar member={who ?? { id: a.actorId ?? 'x', name: 'Someone', avatarUrl: null }} size={22} />
                <p>
                  <strong>{who?.name.split(' ')[0] ?? 'Someone'}</strong> {a.summary}
                  <time className="muted-sm" dateTime={a.createdAt}>
                    {' '}
                    · {relativeTime(a.createdAt)}
                  </time>
                </p>
              </li>
            );
          })}
        </ul>
        {q.hasNextPage && (
          <Button size="sm" variant="ghost" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Show more
          </Button>
        )}
      </div>
    </section>
  );
}

