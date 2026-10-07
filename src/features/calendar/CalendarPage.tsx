import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Button, EmptyState, IconButton, Notice, Segmented } from '../../components/ui.tsx';
import { AddedBy, useMemberLookup } from '../../components/AddedBy.tsx';
import { Icon } from '../../lib/icons.tsx';
import { errorMessage } from '../../lib/api.ts';
import { useEvents, useMembers, useProjects, useTasks } from '../../lib/queries.ts';
import { storage } from '../../lib/theme.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { HOUR_PX, SNAP_MIN, layoutDay, minutesToHHMM, nowMinutes, onDay, rangeFor, stepDate, type CalView } from './calUtils.ts';
import { ScopeDialog } from './EventDetails.tsx';
import { useReschedule, type MoveTarget } from './useReschedule.ts';
import { formatTime12 } from '../tasks/taskUtils.ts';
import { formatISO, formatInstant, formatMonth, minutesInZone, monthKey, todayIn, weekday } from '../../../shared/dates.ts';
import type { EventOccurrence, Task } from '../../../shared/types.ts';

const prefs = storage<{ view: CalView; showTasks: boolean; showEvents: boolean }>('lumera.calendar', { view: 'month', showTasks: true, showEvents: true });
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPage() {
  const me = useMeData();
  const ui = useUI();
  const tz = tzOf(me);
  const today = todayIn(tz);
  const [params, setParams] = useSearchParams();
  const saved = prefs.get();
  const view = (params.get('view') as CalView) || saved.view;
  const date = params.get('date') || today;
  const scope = (params.get('scope') as 'team' | 'mine') || 'team';
  const [showTasks, setShowTasks] = useState(saved.showTasks);
  const [showEvents, setShowEvents] = useState(saved.showEvents);
  const [agendaDays, setAgendaDays] = useState(30);
  const projectId = params.get('project') ?? undefined;
  const memberId = params.get('member') ?? undefined;
  const members = useMembers().data ?? [];
  const projects = useProjects().data ?? [];
  const weekStartsOn = me.workspace!.weekStartsOn;
  const range = rangeFor(view, date, weekStartsOn, agendaDays);

  const set = (next: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  useEffect(() => {
    document.title = 'Calendar · Lumera Creative';
  }, []);
  useEffect(() => prefs.set({ view, showTasks, showEvents }), [view, showTasks, showEvents]);

  const events = useEvents({ from: range.from, to: range.to, tz, scope, projectId, memberId }, showEvents);
  const tasks = useTasks(
    { view: scope === 'mine' ? 'mine' : 'team', from: range.from, to: range.to, status: 'todo,in_progress,review,done', projectId, assigneeId: memberId, limit: 200 },
    showTasks,
  );
  const evs = useMemo(() => (showEvents ? (events.data ?? []) : []), [events.data, showEvents]);
  const tks = useMemo(() => (showTasks ? (tasks.data?.items ?? []) : []), [tasks.data, showTasks]);

  // Open an event linked from elsewhere (?event=…&occurrence=…).
  const linked = params.get('event');
  useEffect(() => {
    if (!linked || !events.data) return;
    const occ = params.get('occurrence');
    const match = events.data.find((o) => o.eventId === linked && (!occ || o.occurrenceKey === occ)) ?? events.data.find((o) => o.eventId === linked);
    if (match) ui.showEvent(match);
    set({ event: null, occurrence: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, events.data]);

  const { moveEvent, moveTask } = useReschedule(tz);
  const [pendingMove, setPendingMove] = useState<{ o: EventOccurrence; to: MoveTarget } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind: 'event'; o: EventOccurrence } | { kind: 'task'; task: Task } | undefined;
    const over = e.over?.data.current as { date: string; timed: boolean } | undefined;
    if (!data || !over) return;
    if (data.kind === 'task') return void moveTask(data.task, over.date);
    const o = data.o;
    let to: MoveTarget = { date: over.date, startMin: null };
    if (over.timed && !o.allDay) {
      const orig = minutesInZone(new Date(o.startsAt!), tz);
      const deltaMin = Math.round(((e.delta.y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
      to = { date: over.date, startMin: Math.min(Math.max(orig + deltaMin, 0), 24 * 60 - SNAP_MIN) };
    } else if (over.timed && o.allDay) return; // all-day events stay in the all-day row
    if (o.recurring) setPendingMove({ o, to });
    else void moveEvent(o, to, 'series');
  };

  const title =
    view === 'month'
      ? formatMonth(monthKey(date))
      : view === 'week'
        ? `${formatISO(range.from, { month: 'short', day: 'numeric' })} – ${formatISO(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : view === 'day'
          ? formatISO(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : `From ${formatISO(date, { month: 'long', day: 'numeric' })}`;
  const loading = (showEvents && events.isPending) || (showTasks && tasks.isPending);
  const error = events.error ?? tasks.error;

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Shared calendar</p>
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon="calendarAdd" onClick={() => ui.openNewEvent({ date: view === 'day' ? date : today })}>
            New event
          </Button>
        </div>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <Button variant="secondary" size="sm" onClick={() => set({ date: null })} disabled={date === today}>
            Today
          </Button>
          <IconButton icon="left" label={`Previous ${view}`} onClick={() => set({ date: stepDate(view, date, -1) })} />
          <IconButton icon="right" label={`Next ${view}`} onClick={() => set({ date: stepDate(view, date, 1) })} />
          {loading && <span className="spinner" style={{ width: 14, height: 14 }} aria-label="Loading" />}
        </div>
        <Segmented<CalView>
          label="Calendar view"
          size="sm"
          value={view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
            { value: 'agenda', label: 'Agenda' },
          ]}
        />
      </div>

      <div className="filters cal-filters" role="group" aria-label="Calendar filters">
        <Segmented<'team' | 'mine'>
          label="Whose calendar"
          size="sm"
          value={scope}
          onChange={(v) => set({ scope: v === 'team' ? null : v })}
          options={[
            { value: 'team', label: 'Team', icon: 'people' },
            { value: 'mine', label: 'Mine', icon: 'user' },
          ]}
        />
        <button type="button" className={`filter-chip ${showEvents ? 'is-on' : ''}`} aria-pressed={showEvents} onClick={() => setShowEvents((v) => !v)}>
          <span className="legend-event" aria-hidden="true" /> Events
        </button>
        <button type="button" className={`filter-chip ${showTasks ? 'is-on' : ''}`} aria-pressed={showTasks} onClick={() => setShowTasks((v) => !v)}>
          <span className="legend-task" aria-hidden="true" /> Tasks due
        </button>
        <label className="sr-only" htmlFor="cal-project">
          Project
        </label>
        <select id="cal-project" className="select select-sm" value={projectId ?? ''} onChange={(e) => set({ project: e.target.value || null })}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {scope === 'team' && (
          <>
            <label className="sr-only" htmlFor="cal-member">
              Person
            </label>
            <select id="cal-member" className="select select-sm" value={memberId ?? ''} onChange={(e) => set({ member: e.target.value || null })}>
              <option value="">Everyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {error && <Notice tone="danger" action={<Button size="sm" onClick={() => { void events.refetch(); void tasks.refetch(); }}>Retry</Button>}>{errorMessage(error)}</Notice>}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === 'month' && <MonthView days={range.days} month={monthKey(date)} today={today} tz={tz} events={evs} tasks={tks} onMore={(d) => set({ view: 'day', date: d })} />}
        {(view === 'week' || view === 'day') && <TimeGrid days={range.days} today={today} tz={tz} events={evs} tasks={tks} />}
      </DndContext>
      {view === 'agenda' && <AgendaView days={range.days} today={today} tz={tz} events={evs} tasks={tks} onMore={() => setAgendaDays((d) => d + 30)} />}
      <p className="fine-print cal-hint">
        <Icon name="info" size={13} /> Drag an event or task to reschedule it, or open it to change the date and time. Times are shown in {tz.replace(/_/g, ' ')}.
      </p>

      <ScopeDialog
        open={pendingMove !== null}
        action="move"
        onClose={() => setPendingMove(null)}
        onChoose={(s) => {
          const m = pendingMove!;
          setPendingMove(null);
          void moveEvent(m.o, m.to, s);
        }}
      />
    </div>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────────

function EventChip({ o, tz, compact }: { o: EventOccurrence; tz: string; compact?: boolean }) {
  const ui = useUI();
  const who = useMemberLookup()(o.createdBy);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `e:${o.key}`, data: { kind: 'event', o } });
  const time = o.allDay ? null : formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`cal-chip is-event ${o.allDay ? 'is-allday' : ''} ${isDragging ? 'is-dragging' : ''} ${compact ? 'is-compact' : ''}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 5 } : undefined}
      onClick={() => ui.showEvent(o)}
      {...listeners}
      {...attributes}
      aria-roledescription="Event"
      aria-label={`${o.title}, ${o.allDay ? 'all day' : time}${o.recurring ? ', repeats' : ''}${who ? `, added by ${who.name}` : ''}`}
      title={who ? `${o.title} · added by ${who.name}` : o.title}
    >
      {time && <span className="cal-chip-time">{time}</span>}
      <span className="cal-chip-title">{o.title}</span>
      {o.recurring && <Icon name="repeat" size={11} className="cal-chip-icon" />}
      <AddedBy userId={o.createdBy} variant="avatar" />
    </button>
  );
}

function TaskChip({ task }: { task: Task }) {
  const ui = useUI();
  const who = useMemberLookup()(task.createdBy);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `t:${task.id}`, data: { kind: 'task', task } });
  const done = task.status === 'done';
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`cal-chip is-task p-${task.priority} ${done ? 'is-done' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 5 } : undefined}
      onClick={() => ui.openTask(task.id)}
      {...listeners}
      {...attributes}
      aria-roledescription="Task"
      aria-label={`Task due${task.dueTime ? ` at ${formatTime12(task.dueTime)}` : ''}: ${task.title}${done ? ', completed' : ''}${who ? `, added by ${who.name}` : ''}`}
      title={who ? `${task.title} · added by ${who.name}` : task.title}
    >
      <span className="cal-task-box" aria-hidden="true">
        {done && <Icon name="check" size={10} />}
      </span>
      <span className="cal-chip-title">{task.title}</span>
      {task.dueTime && <span className="cal-chip-time">{formatTime12(task.dueTime)}</span>}
      <AddedBy userId={task.createdBy} variant="avatar" />
    </button>
  );
}

// ─── Month ───────────────────────────────────────────────────────────────

const MAX_IN_CELL = 3;

function MonthView({ days, month, today, tz, events, tasks, onMore }: { days: string[]; month: string; today: string; tz: string; events: EventOccurrence[]; tasks: Task[]; onMore: (d: string) => void }) {
  return (
    <div className="month" role="grid" aria-label="Month">
      <div className="month-head" role="row">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="month-dow" role="columnheader">
            {WEEKDAY_SHORT[weekday(d)]}
          </span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const dayEvents = events.filter((o) => onDay(o, d, tz));
          const dayTasks = tasks.filter((t) => t.dueDate === d);
          return <MonthCell key={d} day={d} inMonth={d.startsWith(month)} today={today} tz={tz} events={dayEvents} tasks={dayTasks} onMore={onMore} />;
        })}
      </div>
    </div>
  );
}

function MonthCell({ day, inMonth, today, tz, events, tasks, onMore }: { day: string; inMonth: boolean; today: string; tz: string; events: EventOccurrence[]; tasks: Task[]; onMore: (d: string) => void }) {
  const ui = useUI();
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, data: { date: day, timed: false } });
  const items = [...events.filter((e) => e.allDay), ...events.filter((e) => !e.allDay), ...tasks];
  const shown = items.slice(0, MAX_IN_CELL);
  const extra = items.length - shown.length;
  const label = formatISO(day, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div ref={setNodeRef} role="gridcell" className={`month-cell ${inMonth ? '' : 'is-outside'} ${day === today ? 'is-today' : ''} ${isOver ? 'is-over' : ''}`} aria-label={`${label}, ${events.length} events, ${tasks.length} tasks due`}>
      <button type="button" className="month-date" onClick={() => onMore(day)} aria-label={`Open ${label}`}>
        {Number(day.slice(8))}
      </button>
      <div className="month-items">
        {shown.map((it) => ('eventId' in it ? <EventChip key={it.key} o={it} tz={tz} compact /> : <TaskChip key={it.id} task={it} />))}
        {extra > 0 && (
          <button type="button" className="month-more" onClick={() => onMore(day)}>
            +{extra} more
          </button>
        )}
      </div>
      <button type="button" className="month-add" aria-label={`New event on ${label}`} onClick={() => ui.openNewEvent({ date: day })}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

// ─── Week & day ──────────────────────────────────────────────────────────

function TimeGrid({ days, today, tz, events, tasks }: { days: string[]; today: string; tz: string; events: EventOccurrence[]; tasks: Task[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => nowMinutes(tz));
  useEffect(() => {
    // Start the day around 8 AM.
    if (scroller.current) scroller.current.scrollTop = HOUR_PX * 7.5;
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(nowMinutes(tz)), 60_000);
    return () => window.clearInterval(t);
  }, [tz]);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className={`timegrid ${days.length === 1 ? 'is-day' : ''}`}>
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <span key={d} className={`tg-dayname ${d === today ? 'is-today' : ''}`}>
            <span className="tg-dow">{WEEKDAY_SHORT[weekday(d)]}</span>
            <span className="tg-num">{Number(d.slice(8))}</span>
          </span>
        ))}
      </div>
      <div className="tg-allday" style={{ gridTemplateColumns: cols }}>
        <span className="tg-allday-label">All day</span>
        {days.map((d) => (
          <AllDayCell key={d} day={d} tz={tz} events={events.filter((o) => o.allDay && onDay(o, d, tz))} tasks={tasks.filter((t) => t.dueDate === d)} />
        ))}
      </div>
      <div className="tg-body" ref={scroller}>
        <div className="tg-canvas" style={{ gridTemplateColumns: cols, height: HOUR_PX * 24 }}>
          <div className="tg-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="tg-hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : formatTime12(`${String(h).padStart(2, '0')}:00`).replace(':00', '')}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn key={d} day={d} tz={tz} events={events} isToday={d === today} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AllDayCell({ day, tz, events, tasks }: { day: string; tz: string; events: EventOccurrence[]; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `allday:${day}`, data: { date: day, timed: false } });
  return (
    <div ref={setNodeRef} className={`tg-allday-cell ${isOver ? 'is-over' : ''}`}>
      {events.map((o) => (
        <EventChip key={o.key} o={o} tz={tz} compact />
      ))}
      {tasks.map((t) => (
        <TaskChip key={t.id} task={t} />
      ))}
    </div>
  );
}

function DayColumn({ day, tz, events, isToday, now }: { day: string; tz: string; events: EventOccurrence[]; isToday: boolean; now: number }) {
  const ui = useUI();
  const { setNodeRef, isOver } = useDroppable({ id: `col:${day}`, data: { date: day, timed: true } });
  const placed = useMemo(() => layoutDay(events, day, tz), [events, day, tz]);
  const onSlot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30;
    ui.openNewEvent({ date: day, startTime: minutesToHHMM(minutes), endTime: minutesToHHMM(Math.min(minutes + 30, 23 * 60 + 59)) });
  };
  return (
    <div ref={setNodeRef} className={`tg-col ${isOver ? 'is-over' : ''}`} onClick={onSlot} aria-label={`${formatISO(day, { weekday: 'long', month: 'long', day: 'numeric' })}. Click an empty slot to add an event.`}>
      {placed.map((p) => (
        <TimedEvent key={p.o.key} p={p} tz={tz} />
      ))}
      {isToday && <span className="tg-now" style={{ top: (now / 60) * HOUR_PX }} aria-hidden="true" />}
    </div>
  );
}

function TimedEvent({ p, tz }: { p: ReturnType<typeof layoutDay>[number]; tz: string }) {
  const ui = useUI();
  const who = useMemberLookup()(p.o.createdBy);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `e:${p.o.key}:${p.top}`, data: { kind: 'event', o: p.o } });
  const width = 100 / p.cols;
  const start = formatInstant(p.o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' });
  const end = formatInstant(p.o.endsAt!, tz, { hour: 'numeric', minute: '2-digit' });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`tg-event ${isDragging ? 'is-dragging' : ''} ${p.height < 34 ? 'is-short' : ''}`}
      style={{
        top: p.top,
        height: p.height,
        left: `calc(${p.col * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        ui.showEvent(p.o);
      }}
      {...listeners}
      {...attributes}
      aria-roledescription="Event"
      aria-label={`${p.o.title}, ${start} to ${end}${who ? `, added by ${who.name}` : ''}`}
      title={who ? `${p.o.title} · added by ${who.name}` : p.o.title}
    >
      <span className="tg-event-title">
        {p.height < 52 && <AddedBy userId={p.o.createdBy} variant="avatar" />}
        {p.o.title}
        {p.o.recurring && <Icon name="repeat" size={11} />}
      </span>
      <span className="tg-event-time">
        {p.continuesBefore ? '…' : start} – {p.continuesAfter ? '…' : end}
      </span>
      {p.height >= 52 && (
        <span className="tg-event-by" aria-hidden="true">
          <AddedBy userId={p.o.createdBy} />
        </span>
      )}
    </button>
  );
}

// ─── Agenda ──────────────────────────────────────────────────────────────

function AgendaView({ days, today, tz, events, tasks, onMore }: { days: string[]; today: string; tz: string; events: EventOccurrence[]; tasks: Task[]; onMore: () => void }) {
  const ui = useUI();
  const withItems = days
    .map((d) => ({ d, evs: events.filter((o) => onDay(o, d, tz)), tks: tasks.filter((t) => t.dueDate === d) }))
    .filter((x) => x.evs.length || x.tks.length);
  return (
    <div className="agenda">
      {withItems.length === 0 && (
        <div className="card">
          <EmptyState icon="calendar" title="Nothing scheduled" action={<Button variant="secondary" icon="calendarAdd" onClick={() => ui.openNewEvent({ date: days[0] })}>Add an event</Button>}>
            No events or task due dates in the next {days.length} days.
          </EmptyState>
        </div>
      )}
      {withItems.map(({ d, evs, tks }) => (
        <section key={d} className={`agenda-day card ${d === today ? 'is-today' : ''}`} aria-label={formatISO(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
          <h2 className="agenda-date">
            <span className="agenda-dow">{d === today ? 'Today' : formatISO(d, { weekday: 'long' })}</span>
            <span className="agenda-md">{formatISO(d, { month: 'long', day: 'numeric' })}</span>
          </h2>
          <ul className="agenda-list">
            {evs.map((o) => (
              <li key={o.key}>
                <button type="button" className="agenda-item" onClick={() => ui.showEvent(o)}>
                  <span className="agenda-time">{o.allDay ? 'All day' : `${formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' })} – ${formatInstant(o.endsAt!, tz, { hour: 'numeric', minute: '2-digit' })}`}</span>
                  <span className="legend-event" aria-hidden="true" />
                  <span className="agenda-title">
                    {o.title}
                    {o.location && <span className="muted-sm"> · {o.location}</span>}
                  </span>
                  {o.recurring && <Icon name="repeat" size={14} />}
                  <AddedBy userId={o.createdBy} showVerb />
                </button>
              </li>
            ))}
            {tks.map((t) => (
              <li key={t.id}>
                <button type="button" className={`agenda-item ${t.status === 'done' ? 'is-done' : ''}`} onClick={() => ui.openTask(t.id)}>
                  <span className="agenda-time">{t.dueTime ? `Due ${formatTime12(t.dueTime)}` : 'Due'}</span>
                  <span className="legend-task" aria-hidden="true" />
                  <span className="agenda-title">
                    {t.title}
                    {t.projectName && <span className="muted-sm"> · {t.projectName}</span>}
                  </span>
                  <AddedBy userId={t.createdBy} showVerb />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="load-more">
        <Button variant="secondary" onClick={onMore}>
          Show 30 more days
        </Button>
      </div>
    </div>
  );
}
