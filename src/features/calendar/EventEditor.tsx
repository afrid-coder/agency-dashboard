import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Checkbox, Field, Notice, Skeleton, describedBy } from '../../components/ui.tsx';
import { MemberPicker } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateEvents, useMembers, useProjects } from '../../lib/queries.ts';
import { newKey, timeZoneOptions } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { REMINDERS, formFromOccurrence, presetOf, seriesDate, type RepeatPreset } from './calUtils.ts';
import { describeRecurrence } from '../../../shared/recurrence.ts';
import { formatInstant, todayIn, weekday, zonedToUtc } from '../../../shared/dates.ts';
import type { EventOccurrence, EventSeries, Recurrence } from '../../../shared/types.ts';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function EventEditor() {
  const ui = useUI();
  const ed = ui.eventEditor;
  const series = useQuery({
    queryKey: ['event-series', ed?.occurrence?.eventId],
    queryFn: () => api.get<EventSeries>(`/events/${ed!.occurrence!.eventId}`),
    enabled: Boolean(ed?.occurrence),
  });
  const title = !ed ? '' : !ed.occurrence ? 'New event' : ed.scope === 'occurrence' ? 'Edit this occurrence' : ed.occurrence.recurring ? 'Edit all events in the series' : 'Edit event';
  return (
    <Dialog open={Boolean(ed)} onClose={ui.closeEventEditor} title={title} size="md">
      {ed && ed.occurrence && series.isPending && <Skeleton h={220} />}
      {ed && ed.occurrence && series.isError && <Notice tone="danger">{errorMessage(series.error)}</Notice>}
      {ed && (!ed.occurrence || series.data) && (
        <EventForm key={`${ed.occurrence?.key ?? 'new'}-${series.data?.version ?? 0}`} occurrence={ed.occurrence} scope={ed.scope} series={series.data ?? null} onReload={() => void series.refetch()} />
      )}
    </Dialog>
  );
}

function EventForm({ occurrence, scope, series, onReload }: { occurrence: EventOccurrence | null; scope: 'series' | 'occurrence'; series: EventSeries | null; onReload: () => void }) {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers().data ?? [];
  const projects = (useProjects().data ?? []).filter((p) => p.status !== 'archived');
  const viewerTz = tzOf(me);
  const d = ui.eventEditor?.defaults ?? {};
  const initial = occurrence ? formFromOccurrence(occurrence) : null;
  const onlyOne = scope === 'occurrence';

  const [title, setTitle] = useState(occurrence?.title ?? '');
  const [allDay, setAllDay] = useState(initial?.allDay ?? d.allDay ?? false);
  const [date, setDate] = useState(initial?.date ?? d.date ?? todayIn(viewerTz));
  const [endDate, setEndDate] = useState(initial?.endDate ?? d.date ?? todayIn(viewerTz));
  const [startTime, setStartTime] = useState(initial?.startTime ?? d.startTime ?? '10:00');
  const [endTime, setEndTime] = useState(initial?.endTime ?? d.endTime ?? '10:30');
  const [endsLater, setEndsLater] = useState(Boolean(initial?.endDateTimed));
  const [endDateTimed, setEndDateTimed] = useState(initial?.endDateTimed ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone ?? viewerTz);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(occurrence?.attendeeIds ?? [me.user.id]);
  const [projectId, setProjectId] = useState(occurrence?.projectId ?? d.projectId ?? '');
  const [visibility, setVisibility] = useState<'team' | 'private'>(occurrence?.visibility ?? 'team');
  const [reminder, setReminder] = useState<number | null>(occurrence ? occurrence.reminderMinutes : me.preferences.defaultReminderMinutes);
  const [location, setLocation] = useState(occurrence?.location ?? '');
  const [description, setDescription] = useState(occurrence?.description ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence | null>(series?.recurrence ?? null);
  const [preset, setPreset] = useState<RepeatPreset>(presetOf(series?.recurrence ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; stale?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);

  const applyPreset = (p: RepeatPreset) => {
    setPreset(p);
    const wd = weekday(date);
    if (p === 'none') setRecurrence(null);
    else if (p === 'daily') setRecurrence({ freq: 'daily', interval: 1 });
    else if (p === 'weekdays') setRecurrence({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] });
    else if (p === 'weekly') setRecurrence({ freq: 'weekly', interval: 1, byWeekday: [wd] });
    else if (p === 'monthly') setRecurrence({ freq: 'monthly', interval: 1 });
    else setRecurrence((r) => r ?? { freq: 'weekly', interval: 1, byWeekday: [wd] });
  };

  // Scheduling conflicts for the chosen people, checked as the time changes.
  const [conflicts, setConflicts] = useState<EventOccurrence[]>([]);
  useEffect(() => {
    if (allDay || !startTime || !endTime || endTime <= startTime || endsLater) {
      setConflicts([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<EventOccurrence[]>('/events/conflicts', { date, startTime, endTime, timezone, attendeeIds, excludeEventId: occurrence?.eventId })
        .then(setConflicts)
        .catch(() => setConflicts([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [allDay, date, startTime, endTime, timezone, attendeeIds, endsLater, occurrence?.eventId]);

  const zones = useMemo(() => timeZoneOptions(timezone), [timezone]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Give the event a title.';
    if (allDay && endDate < date) errs.endDate = 'The last day must be on or after the first day.';
    if (!allDay && !endsLater && endTime <= startTime) errs.endTime = 'End time must be after the start time.';
    if (!allDay && endsLater && (!endDateTimed || endDateTimed <= date)) errs.endDateTimed = 'Choose a later end date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const formDate = series && occurrence && scope === 'series' && occurrence.recurring ? seriesDate(series, occurrence, date) : date;
    const dayShift = formDate !== date;
    const body = {
      title: title.trim(),
      description,
      location: location.trim(),
      allDay,
      date: formDate,
      endDate: allDay ? (dayShift ? seriesDate(series!, occurrence!, endDate) : endDate) : null,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      endDateTimed: !allDay && endsLater ? (dayShift ? seriesDate(series!, occurrence!, endDateTimed) : endDateTimed) : null,
      timezone,
      projectId: projectId || null,
      attendeeIds,
      visibility,
      reminderMinutes: allDay ? null : reminder,
      recurrence: onlyOne ? series?.recurrence ?? null : recurrence,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (!occurrence) await api.post('/events', { ...body, idempotencyKey: key });
      else await api.put(`/events/${occurrence.eventId}`, { scope: onlyOne ? 'occurrence' : 'series', occurrenceKey: occurrence.occurrenceKey, version: series!.version, event: body });
      invalidateEvents(qc);
      void qc.invalidateQueries({ queryKey: ['event-series'] });
      ui.closeEventEditor();
      ui.showEvent(null);
      toast({ tone: 'success', message: occurrence ? 'Event updated' : `“${body.title}” added to the calendar` });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (Object.keys(err.fields).length) setErrors(err.fields);
        setFormError({ message: err.message, stale: err.code === 'conflict' });
      } else setFormError({ message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  // When scheduling in another zone, show what that means for the person scheduling.
  const localPreview =
    !allDay && timezone !== viewerTz && startTime
      ? `That’s ${formatInstant(zonedToUtc(date, startTime, timezone), viewerTz, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} in your time zone (${viewerTz.replace(/_/g, ' ')}).`
      : null;

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {onlyOne && (
        <Notice tone="info" icon="repeat">
          Changes apply to this occurrence only. Repeat, people, project and reminder settings belong to the whole series.
        </Notice>
      )}
      {scope === 'series' && occurrence?.recurring && (
        <Notice tone="info" icon="repeat">
          Changes apply to every event in this series. If you change the time or repeat pattern, earlier one-off changes to individual occurrences are reset.
        </Notice>
      )}
      <Field label="Title" htmlFor="ev-title" error={errors.title}>
        <input id="ev-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-autofocus aria-invalid={Boolean(errors.title) || undefined} aria-describedby={describedBy('ev-title', errors.title)} placeholder="e.g. Harbor Dental design review" />
      </Field>
      <Checkbox checked={allDay} onChange={setAllDay} label="All day" />
      {allDay ? (
        <div className="form-row">
          <Field label="First day" htmlFor="ev-date">
            <input id="ev-date" type="date" className="input" value={date} onChange={(e) => {
              setDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }} required />
          </Field>
          <Field label="Last day" htmlFor="ev-end" error={errors.endDate}>
            <input id="ev-end" type="date" className="input" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <div className="form-row form-row-3">
            <Field label="Date" htmlFor="ev-date">
              <input id="ev-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Starts" htmlFor="ev-start">
              <input id="ev-start" type="time" className="input" value={startTime} step={300} onChange={(e) => setStartTime(e.target.value)} required />
            </Field>
            <Field label="Ends" htmlFor="ev-endt" error={errors.endTime}>
              <input id="ev-endt" type="time" className="input" value={endTime} step={300} onChange={(e) => setEndTime(e.target.value)} required />
            </Field>
          </div>
          <Checkbox checked={endsLater} onChange={(v) => { setEndsLater(v); if (v && !endDateTimed) setEndDateTimed(date); }} label="Ends on a later day" />
          {endsLater && (
            <Field label="End date" htmlFor="ev-endd" error={errors.endDateTimed}>
              <input id="ev-endd" type="date" className="input" value={endDateTimed} min={date} onChange={(e) => setEndDateTimed(e.target.value)} />
            </Field>
          )}
          <Field label="Time zone" htmlFor="ev-tz" hint={localPreview ?? 'Times are shown to each teammate in their own time zone.'}>
            <select id="ev-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={onlyOne}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {conflicts.length > 0 && (
        <Notice tone="warning" icon="calendarMark">
          <span>
            Overlaps with{' '}
            {conflicts.map((c, i) => (
              <span key={c.key}>
                {i > 0 && ', '}“{c.title}” ({formatInstant(c.startsAt!, viewerTz, { hour: 'numeric', minute: '2-digit' })})
              </span>
            ))}
            . You can still save it.
          </span>
        </Notice>
      )}
      {!onlyOne && (
        <>
          <Field label="Repeat" htmlFor="ev-repeat" hint={recurrence ? describeRecurrence(recurrence) : undefined}>
            <select id="ev-repeat" className="select" value={preset} onChange={(e) => applyPreset(e.target.value as RepeatPreset)}>
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Every week on {WEEKDAY_NAMES[weekday(date)]}</option>
              <option value="monthly">Every month on day {Number(date.slice(8))}</option>
              <option value="custom">Custom…</option>
            </select>
          </Field>
          {recurrence && preset === 'custom' && (
            <fieldset className="repeat-custom">
              <legend className="sr-only">Custom repeat</legend>
              <div className="form-row">
                <Field label="Every" htmlFor="ev-interval">
                  <input id="ev-interval" type="number" min={1} max={12} className="input" value={recurrence.interval} onChange={(e) => setRecurrence({ ...recurrence, interval: Math.min(Math.max(Number(e.target.value) || 1, 1), 12) })} />
                </Field>
                <Field label="Unit" htmlFor="ev-freq">
                  <select id="ev-freq" className="select" value={recurrence.freq} onChange={(e) => setRecurrence({ ...recurrence, freq: e.target.value as Recurrence['freq'], byWeekday: e.target.value === 'weekly' ? [weekday(date)] : undefined })}>
                    <option value="daily">day(s)</option>
                    <option value="weekly">week(s)</option>
                    <option value="monthly">month(s)</option>
                  </select>
                </Field>
              </div>
              {recurrence.freq === 'weekly' && (
                <div className="weekday-picks" role="group" aria-label="Repeat on">
                  {WEEKDAYS.map((w, i) => {
                    const on = recurrence.byWeekday?.includes(i) ?? false;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`weekday-pick ${on ? 'is-on' : ''}`}
                        aria-pressed={on}
                        aria-label={WEEKDAY_NAMES[i]}
                        onClick={() => {
                          const cur = recurrence.byWeekday ?? [];
                          const next = on ? cur.filter((x) => x !== i) : [...cur, i];
                          setRecurrence({ ...recurrence, byWeekday: next.length ? next.sort() : [weekday(date)] });
                        }}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}
          {recurrence && (
            <div className="form-row">
              <Field label="Ends" htmlFor="ev-ends">
                <select
                  id="ev-ends"
                  className="select"
                  value={recurrence.count ? 'count' : recurrence.until ? 'until' : 'never'}
                  onChange={(e) => setRecurrence({ ...recurrence, count: e.target.value === 'count' ? 10 : null, until: e.target.value === 'until' ? date : null })}
                >
                  <option value="never">Never</option>
                  <option value="until">On a date</option>
                  <option value="count">After a number of times</option>
                </select>
              </Field>
              {recurrence.until && (
                <Field label="Last date" htmlFor="ev-until">
                  <input id="ev-until" type="date" className="input" min={date} value={recurrence.until} onChange={(e) => setRecurrence({ ...recurrence, until: e.target.value || null })} />
                </Field>
              )}
              {recurrence.count != null && (
                <Field label="Occurrences" htmlFor="ev-count">
                  <input id="ev-count" type="number" min={1} max={730} className="input" value={recurrence.count} onChange={(e) => setRecurrence({ ...recurrence, count: Math.min(Math.max(Number(e.target.value) || 1, 1), 730) })} />
                </Field>
              )}
            </div>
          )}
          <Field label="People" htmlFor="ev-people" error={errors.attendeeIds}>
            <MemberPicker id="ev-people" label="Attendees" members={members} value={attendeeIds} onChange={setAttendeeIds} placeholder="Just you" />
          </Field>
          <div className="form-row">
            <Field label="Project" htmlFor="ev-project" optional>
              <select id="ev-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visible to" htmlFor="ev-vis">
              <select id="ev-vis" className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'team' | 'private')}>
                <option value="team">Whole team</option>
                <option value="private">Only you and attendees</option>
              </select>
            </Field>
          </div>
          {!allDay && (
            <Field label="Reminder" htmlFor="ev-rem" hint="Sent in the app to attendees who have reminders turned on.">
              <select id="ev-rem" className="select" value={reminder === null ? '' : String(reminder)} onChange={(e) => setReminder(e.target.value === '' ? null : Number(e.target.value))}>
                {REMINDERS.map((r) => (
                  <option key={r.label} value={r.value === null ? '' : String(r.value)}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      <Field label="Location or meeting link" htmlFor="ev-loc" optional>
        <input id="ev-loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
      </Field>
      <Field label="Description" htmlFor="ev-desc" optional>
        <textarea id="ev-desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} placeholder="Agenda, links or notes" />
      </Field>
      {formError && (
        <Notice
          tone="danger"
          action={
            formError.stale ? (
              <Button size="sm" variant="secondary" icon="refresh" onClick={onReload}>
                Reload
              </Button>
            ) : undefined
          }
        >
          {formError.message}
        </Notice>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={ui.closeEventEditor}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {occurrence ? 'Save changes' : 'Add to calendar'}
        </Button>
      </div>
      <p className="fine-print">
        <Icon name="info" size={13} /> Events are scheduled time. Tasks with due dates appear on the calendar separately.
      </p>
    </form>
  );
}
