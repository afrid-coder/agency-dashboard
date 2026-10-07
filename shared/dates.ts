// Calendar-date helpers. Dates are plain 'YYYY-MM-DD' strings in the workspace
// timezone, so arithmetic happens on UTC midnights and never drifts with the
// viewer's local offset.

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsIn(tz: string, at: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) out[p.type] = p.value;
  return out;
}

export function todayIn(tz: string, at: Date = new Date()): ISODate {
  const p = partsIn(tz, at);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nowTimeIn(tz: string, at: Date = new Date()): string {
  const p = partsIn(tz, at);
  return `${p.hour}:${p.minute}`;
}

export function hourIn(tz: string, at: Date = new Date()): number {
  return Number(partsIn(tz, at).hour);
}

function toUTC(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt: Date): ISODate {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  const dt = toUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: ISODate): number {
  return toUTC(iso).getUTCDay();
}

export function startOfWeek(iso: ISODate, weekStartsOn = 1): ISODate {
  const offset = (weekday(iso) - weekStartsOn + 7) % 7;
  return addDays(iso, -offset);
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function firstOfMonth(month: string): ISODate {
  return `${month}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
}

export function lastOfMonth(month: string): ISODate {
  return addDays(firstOfMonth(addMonths(month, 1)), -1);
}

/** 42 dates (6 weeks) covering the month, starting on weekStartsOn. */
export function monthGrid(month: string, weekStartsOn = 1): ISODate[] {
  const start = startOfWeek(firstOfMonth(month), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDates(iso: ISODate, weekStartsOn = 1): ISODate[] {
  const start = startOfWeek(iso, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatISO(iso: ISODate, options: Intl.DateTimeFormatOptions, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(toUTC(iso));
}

export function formatMonth(month: string, locale = 'en-US'): string {
  return formatISO(firstOfMonth(month), { month: 'long', year: 'numeric' }, locale);
}

export function formatTime(hhmm: string | null | undefined, locale = 'en-US'): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  );
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Relative day label: Today, Tomorrow, Yesterday, or a short date. */
export function relativeDay(iso: ISODate, today: ISODate): string {
  const d = diffDays(iso, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return formatISO(iso, { weekday: 'long' });
  return formatISO(iso, { month: 'short', day: 'numeric' });
}

// ─── Time-zone aware instants ────────────────────────────────────────────
// Timed events are stored as UTC instants plus the IANA zone they were
// scheduled in. These helpers convert between the two without a library and
// handle daylight-saving gaps and overlaps.

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(instant)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (local − UTC). */
export function tzOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads `date` `time`.
 * Nonexistent local times (spring-forward gap) move forward by the gap;
 * ambiguous ones (fall-back overlap) resolve to the earlier instant.
 */
export function zonedToUtc(date: ISODate, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = tzOffsetMs(new Date(wall), tz);
  let t = wall - o1;
  const o2 = tzOffsetMs(new Date(t), tz);
  if (o2 !== o1) {
    const t2 = wall - o2;
    // Prefer the candidate whose wall clock matches; if neither does we are in a gap.
    if (tzOffsetMs(new Date(t2), tz) === o2) t = Math.min(t, t2);
    else t = wall - Math.max(o1, o2) + Math.abs(o1 - o2);
  }
  return new Date(t);
}

export function dateInZone(instant: Date, tz: string): ISODate {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function timeInZone(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since local midnight in `tz`. */
export function minutesInZone(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return p.hour * 60 + p.minute;
}

export function startOfDayUtc(date: ISODate, tz: string): Date {
  return zonedToUtc(date, '00:00', tz);
}

export function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function formatInstant(iso: string | Date, tz: string, options: Intl.DateTimeFormatOptions, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(typeof iso === 'string' ? new Date(iso) : iso);
}
