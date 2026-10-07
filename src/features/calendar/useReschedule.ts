// Moving events and tasks by drag. The calendar updates immediately; the save
// runs in the background and rolls back with an explanation if it fails.
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.ts';
import { invalidateEvents, invalidateWork, keys } from '../../lib/queries.ts';
import { useToast } from '../../components/Toast.tsx';
import { addDays, dateInZone, diffDays, minutesInZone, timeInZone, zonedToUtc } from '../../../shared/dates.ts';
import { minutesToHHMM, seriesDate } from './calUtils.ts';
import type { EventOccurrence, EventSeries, Page, Task } from '../../../shared/types.ts';

export interface MoveTarget {
  /** New local date in the viewer's zone. */
  date: string;
  /** New start, minutes after local midnight (timed events in the time grid); null keeps the time. */
  startMin: number | null;
}

export function useReschedule(viewerTz: string) {
  const qc = useQueryClient();
  const toast = useToast();

  const moveEvent = async (o: EventOccurrence, to: MoveTarget, scope: 'series' | 'occurrence') => {
    // Work out the new placement.
    let patch: Partial<EventOccurrence>;
    let form: { allDay: boolean; date: string; endDate: string | null; startTime: string | null; endTime: string | null; endDateTimed: string | null };
    if (o.allDay) {
      const span = diffDays(o.endDate!, o.startDate!);
      patch = { startDate: to.date, endDate: addDays(to.date, span) };
      form = { allDay: true, date: to.date, endDate: addDays(to.date, span), startTime: null, endTime: null, endDateTimed: null };
    } else {
      const start = new Date(o.startsAt!);
      const dur = new Date(o.endsAt!).getTime() - start.getTime();
      const startMin = to.startMin ?? minutesInZone(start, viewerTz);
      const newStart = zonedToUtc(to.date, minutesToHHMM(startMin), viewerTz);
      const newEnd = new Date(newStart.getTime() + dur);
      patch = { startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() };
      const d = dateInZone(newStart, o.timezone);
      const endDay = dateInZone(newEnd, o.timezone);
      form = { allDay: false, date: d, endDate: null, startTime: timeInZone(newStart, o.timezone), endTime: timeInZone(newEnd, o.timezone), endDateTimed: endDay !== d ? endDay : null };
    }
    if ((o.allDay && patch.startDate === o.startDate) || (!o.allDay && patch.startsAt === o.startsAt)) return;

    const snapshot = qc.getQueriesData<EventOccurrence[]>({ queryKey: keys.events });
    qc.setQueriesData<EventOccurrence[]>({ queryKey: keys.events }, (old) =>
      Array.isArray(old) ? old.map((x) => (x.key === o.key ? { ...x, ...patch } : x)) : old,
    );
    try {
      const series = await api.get<EventSeries>(`/events/${o.eventId}`);
      const shift = scope === 'series' && o.recurring;
      const body = {
        title: o.title,
        description: o.description,
        location: o.location,
        allDay: form.allDay,
        date: shift ? seriesDate(series, o, form.date) : form.date,
        endDate: form.endDate ? (shift ? seriesDate(series, o, form.endDate) : form.endDate) : null,
        startTime: form.startTime,
        endTime: form.endTime,
        endDateTimed: form.endDateTimed ? (shift ? seriesDate(series, o, form.endDateTimed) : form.endDateTimed) : null,
        timezone: o.timezone,
        projectId: o.projectId,
        attendeeIds: o.attendeeIds,
        visibility: o.visibility,
        reminderMinutes: o.reminderMinutes,
        recurrence: series.recurrence,
      };
      await api.put(`/events/${o.eventId}`, { scope: o.recurring ? scope : 'series', occurrenceKey: o.occurrenceKey, version: series.version, event: body });
      toast({ tone: 'success', message: `Moved “${o.title}”` });
    } catch (err) {
      snapshot.forEach(([k, data]) => qc.setQueryData(k, data));
      toast({ tone: 'error', message: `Couldn’t move “${o.title}”: ${errorMessage(err)}` });
    } finally {
      invalidateEvents(qc);
    }
  };

  const moveTask = async (task: Task, date: string) => {
    if (task.dueDate === date) return;
    const snapshot = qc.getQueriesData<Page<Task>>({ queryKey: keys.tasks });
    qc.setQueriesData<Page<Task>>({ queryKey: keys.tasks }, (old) => (old && 'items' in old ? { ...old, items: old.items.map((t) => (t.id === task.id ? { ...t, dueDate: date } : t)) } : old));
    try {
      await api.patch(`/tasks/${task.id}`, { changes: { dueDate: date }, base: { dueDate: task.dueDate } });
      toast({
        tone: 'success',
        message: `“${task.title}” now due ${date}`,
        action: { label: 'Undo', onClick: () => void api.patch(`/tasks/${task.id}`, { changes: { dueDate: task.dueDate }, base: { dueDate: date } }).then(() => invalidateWork(qc)) },
      });
    } catch (err) {
      snapshot.forEach(([k, data]) => qc.setQueryData(k, data));
      toast({ tone: 'error', message: `Couldn’t reschedule “${task.title}”: ${errorMessage(err)}` });
    } finally {
      invalidateWork(qc);
    }
  };

  return { moveEvent, moveTask };
}
