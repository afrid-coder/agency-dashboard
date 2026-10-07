// Basic recurring-event rules: daily, weekly (optionally on chosen weekdays)
// and monthly (same day of the month), with an optional end date or count.
// Occurrences are generated as local calendar dates; the event keeps its
// wall-clock start time on each date, so DST changes do not shift meetings.
import { addDays, diffDays, isISODate, startOfWeek, weekday, type ISODate } from './dates.ts';

export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  freq: Frequency;
  /** Every N days/weeks/months, 1–12. */
  interval: number;
  /** Weekly only: 0 = Sunday … 6 = Saturday. Defaults to the start date's weekday. */
  byWeekday?: number[];
  /** Last date an occurrence may start on (inclusive). */
  until?: ISODate | null;
  /** Total number of occurrences, counted from the first. */
  count?: number | null;
}

export const MAX_OCCURRENCES = 730;
const MAX_SCAN_DAYS = 366 * 5;

export function normalizeRecurrence(rule: Recurrence, start: ISODate): Recurrence {
  const interval = Math.min(Math.max(Math.trunc(rule.interval || 1), 1), 12);
  const out: Recurrence = { freq: rule.freq, interval };
  if (rule.freq === 'weekly') {
    const days = [...new Set((rule.byWeekday?.length ? rule.byWeekday : [weekday(start)]).filter((d) => d >= 0 && d <= 6))].sort();
    out.byWeekday = days;
  }
  if (rule.until && isISODate(rule.until)) out.until = rule.until;
  if (rule.count) out.count = Math.min(Math.max(Math.trunc(rule.count), 1), MAX_OCCURRENCES);
  return out;
}

/**
 * Occurrence start dates of a series that begins on `start`, limited to
 * [from, to] (inclusive). Counting always starts at the first occurrence, so
 * `count` behaves the same whatever window is requested.
 */
export function occurrenceDates(start: ISODate, rule: Recurrence, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const last = rule.until && rule.until < to ? rule.until : to;
  if (last < start) return out;
  let n = 0;
  const push = (d: ISODate) => {
    n += 1;
    if (d >= from && d <= last) out.push(d);
  };
  const done = (d: ISODate) => d > last || (rule.count != null && n >= rule.count) || diffDays(d, start) > MAX_SCAN_DAYS;

  if (rule.freq === 'daily') {
    for (let d = start; !done(d); d = addDays(d, rule.interval)) push(d);
  } else if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length ? rule.byWeekday : [weekday(start)];
    // Weeks start on Monday for interval stepping.
    for (let week = startOfWeek(start, 1); ; week = addDays(week, 7 * rule.interval)) {
      if (week > last || diffDays(week, start) > MAX_SCAN_DAYS) break;
      for (let i = 0; i < 7; i++) {
        const d = addDays(week, i);
        if (d < start || !days.includes(weekday(d))) continue;
        if (done(d)) return out;
        push(d);
      }
      if (rule.count != null && n >= rule.count) break;
    }
  } else {
    const [y, m, dd] = start.split('-').map(Number);
    for (let k = 0; ; k += rule.interval) {
      const dt = new Date(Date.UTC(y, m - 1 + k, 1));
      const daysInMonth = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      const monthStart = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
      if (monthStart > last || k > 12 * 5) break;
      if (dd > daysInMonth) continue; // e.g. the 31st in a 30-day month: no occurrence that month
      const d = addDays(monthStart, dd - 1);
      if (done(d)) break;
      push(d);
    }
  }
  return out;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeRecurrence(rule: Recurrence | null | undefined): string {
  if (!rule) return 'Does not repeat';
  const every = (unit: string) => (rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`);
  let text = '';
  if (rule.freq === 'daily') text = rule.interval === 1 ? 'Daily' : every('day');
  else if (rule.freq === 'weekly') {
    const days = (rule.byWeekday ?? []).map((d) => WEEKDAY_NAMES[d]);
    const isWeekdays = days.length === 5 && !rule.byWeekday!.includes(0) && !rule.byWeekday!.includes(6);
    text = `${rule.interval === 1 ? 'Weekly' : every('week')}${isWeekdays ? ' on weekdays' : days.length ? ` on ${days.join(', ')}` : ''}`;
  } else text = rule.interval === 1 ? 'Monthly' : every('month');
  if (rule.count) text += `, ${rule.count} times`;
  else if (rule.until) text += `, until ${rule.until}`;
  return text;
}
