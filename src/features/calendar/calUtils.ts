import { addDays, dateInZone, diffDays, minutesInZone, monthGrid, monthKey, startOfDayUtc, timeInZone, weekDates } from '../../../shared/dates.ts';
import type { EventOccurrence, EventSeries, Recurrence } from '../../../shared/types.ts';

export type CalView = 'month' | 'week' | 'day' | 'agenda';

export const HOUR_PX = 48;
export const SNAP_MIN = 15;

export function rangeFor(view: CalView, date: string, weekStartsOn: 0 | 1, agendaDays = 30): { from: string; to: string; days: string[] } {
  if (view === 'month') {
    const days = monthGrid(monthKey(date), weekStartsOn);
    return { from: days[0], to: days[days.length - 1], days };
  }
  if (view === 'week') {
    const days = weekDates(date, weekStartsOn);
    return { from: days[0], to: days[6], days };
  }
  if (view === 'day') return { from: date, to: date, days: [date] };
  const days = Array.from({ length: agendaDays }, (_, i) => addDays(date, i));
  return { from: date, to: days[days.length - 1], days };
}

export function stepDate(view: CalView, date: string, dir: 1 | -1): string {
  if (view === 'month') {
    const [y, m] = date.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  if (view === 'week') return addDays(date, 7 * dir);
  if (view === 'agenda') return addDays(date, 30 * dir);
  return addDays(date, dir);
}

/** Does the occurrence touch this local date (viewer's zone)? */
export function onDay(o: EventOccurrence, day: string, tz: string): boolean {
  if (o.allDay) return o.startDate! <= day && o.endDate! >= day;
  const start = startOfDayUtc(day, tz).getTime();
  const end = startOfDayUtc(addDays(day, 1), tz).getTime();
  return new Date(o.startsAt!).getTime() < end && new Date(o.endsAt!).getTime() > start;
}

export interface Placed {
  o: EventOccurrence;
  top: number;
  height: number;
  col: number;
  cols: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Positions timed events in one day column, side by side where they overlap. */
export function layoutDay(events: EventOccurrence[], day: string, tz: string): Placed[] {
  const dayStart = startOfDayUtc(day, tz).getTime();
  const dayEnd = startOfDayUtc(addDays(day, 1), tz).getTime();
  // Positioned by wall-clock time, as people read a calendar (DST days keep a 24-hour grid).
  const segs = events
    .filter((o) => !o.allDay && onDay(o, day, tz))
    .map((o) => {
      const s = new Date(o.startsAt!).getTime();
      const e = new Date(o.endsAt!).getTime();
      const before = s < dayStart;
      const after = e > dayEnd || e === dayEnd;
      const startMin = before ? 0 : minutesInZone(new Date(s), tz);
      const endMin = Math.max(after ? 1440 : minutesInZone(new Date(e), tz), startMin + 15);
      return { o, startMin, endMin, before, after: e > dayEnd };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Placed[] = [];
  let cluster: typeof segs = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    const assigned = cluster.map((s) => {
      let col = colEnds.findIndex((end) => end <= s.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(s.endMin);
      } else colEnds[col] = s.endMin;
      return { s, col };
    });
    for (const { s, col } of assigned)
      out.push({
        o: s.o,
        top: (s.startMin / 60) * HOUR_PX,
        height: Math.max(((s.endMin - s.startMin) / 60) * HOUR_PX, 20),
        col,
        cols: colEnds.length,
        continuesBefore: s.before,
        continuesAfter: s.after,
      });
    cluster = [];
  };
  for (const s of segs) {
    if (cluster.length && s.startMin >= clusterEnd) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.endMin);
  }
  if (cluster.length) flush();
  return out;
}

export const nowMinutes = (tz: string) => minutesInZone(new Date(), tz);

/** Form values for an occurrence, expressed in the event's own zone. */
export function formFromOccurrence(o: EventOccurrence) {
  if (o.allDay) return { allDay: true, date: o.startDate!, endDate: o.endDate!, startTime: '09:00', endTime: '10:00', endDateTimed: null as string | null, timezone: o.timezone };
  const s = new Date(o.startsAt!);
  const e = new Date(o.endsAt!);
  const date = dateInZone(s, o.timezone);
  const endDay = dateInZone(e, o.timezone);
  return { allDay: false, date, endDate: date, startTime: timeInZone(s, o.timezone), endTime: timeInZone(e, o.timezone), endDateTimed: endDay !== date ? endDay : null, timezone: o.timezone };
}

/**
 * When editing "all events" from a later occurrence, keep the series anchored
 * at its first date: shift it by however many days the person moved this one.
 */
export function seriesDate(series: EventSeries, occurrence: EventOccurrence, newDate: string) {
  const occDate = occurrence.allDay ? occurrence.startDate! : dateInZone(new Date(occurrence.startsAt!), occurrence.timezone);
  const firstDate = series.allDay ? series.startDate! : dateInZone(new Date(series.startsAt!), series.timezone);
  return addDays(firstDate, diffDays(newDate, occDate));
}

export const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

export function presetOf(r: Recurrence | null): RepeatPreset {
  if (!r) return 'none';
  if (r.interval !== 1) return 'custom';
  if (r.freq === 'daily') return 'daily';
  if (r.freq === 'monthly') return 'monthly';
  const d = r.byWeekday ?? [];
  if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'weekdays';
  if (d.length <= 1) return 'weekly';
  return 'custom';
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const minutesToHHMM = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
