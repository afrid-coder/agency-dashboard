import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Avatar, Button } from '../../components/ui.tsx';
import { AddedBy } from '../../components/AddedBy.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { invalidateEvents, useMembers } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { REMINDERS } from './calUtils.ts';
import { describeRecurrence } from '../../../shared/recurrence.ts';
import { formatISO, formatInstant } from '../../../shared/dates.ts';
import type { EventOccurrence, EventSeries } from '../../../shared/types.ts';

export function whenText(o: EventOccurrence, tz: string) {
  if (o.allDay)
    return o.startDate === o.endDate
      ? `${formatISO(o.startDate!, { weekday: 'long', month: 'long', day: 'numeric' })} · All day`
      : `${formatISO(o.startDate!, { weekday: 'short', month: 'short', day: 'numeric' })} – ${formatISO(o.endDate!, { weekday: 'short', month: 'short', day: 'numeric' })} · All day`;
  const day = formatInstant(o.startsAt!, tz, { weekday: 'long', month: 'long', day: 'numeric' });
  return `${day} · ${formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' })} – ${formatInstant(o.endsAt!, tz, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
}

/** Asks whether a change applies to one occurrence or the whole series. */
export function ScopeDialog({
  open,
  action,
  onChoose,
  onClose,
  busy,
}: {
  open: boolean;
  action: 'edit' | 'delete' | 'move';
  onChoose: (scope: 'occurrence' | 'series') => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const verb = action === 'delete' ? 'Delete' : action === 'move' ? 'Move' : 'Edit';
  return (
    <Dialog open={open} onClose={onClose} title={`${verb} recurring event`} size="sm">
      <p className="confirm-body">This event repeats. Apply the change to:</p>
      <div className="scope-choices">
        <Button variant="secondary" size="lg" onClick={() => onChoose('occurrence')} disabled={busy} data-autofocus>
          This event only
        </Button>
        <Button variant={action === 'delete' ? 'danger' : 'secondary'} size="lg" onClick={() => onChoose('series')} disabled={busy}>
          All events in the series
        </Button>
      </div>
    </Dialog>
  );
}

export function EventDetails() {
  const ui = useUI();
  const o = ui.eventDetails;
  return (
    <Dialog open={Boolean(o)} onClose={() => ui.showEvent(null)} variant="panel" eyebrow={o?.recurring ? 'Recurring event' : 'Event'} title={o?.title ?? ''}>
      {o && <Details key={o.key} o={o} />}
    </Dialog>
  );
}

function Details({ o }: { o: EventOccurrence }) {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers().data ?? [];
  const tz = tzOf(me);
  const series = useQuery({ queryKey: ['event-series', o.eventId], queryFn: () => api.get<EventSeries>(`/events/${o.eventId}`) });
  const [scopeFor, setScopeFor] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const organizer = members.find((m) => m.id === o.createdBy);
  const isAttendee = o.attendeeIds.includes(me.user.id);
  const myResponse = series.data?.attendees.find((a) => a.userId === me.user.id)?.response;
  const canChange = o.visibility === 'team' || o.createdBy === me.user.id;
  const canDelete = can(me, 'tasks.deleteAny') || o.createdBy === me.user.id || isAttendee;

  const remove = async (scope: 'occurrence' | 'series') => {
    setBusy(true);
    try {
      await api.del(`/events/${o.eventId}?scope=${scope}${scope === 'occurrence' && o.occurrenceKey ? `&occurrence=${encodeURIComponent(o.occurrenceKey)}` : ''}`);
      invalidateEvents(qc);
      ui.showEvent(null);
      setScopeFor(null);
      toast({
        tone: 'info',
        message: scope === 'occurrence' && o.recurring ? 'Occurrence cancelled' : 'Event deleted',
        action: {
          label: 'Undo',
          onClick: () =>
            void api
              .post(`/events/${o.eventId}/restore`, { occurrenceKey: scope === 'occurrence' && o.recurring ? o.occurrenceKey : null })
              .then(() => invalidateEvents(qc))
              .catch((e) => toast({ tone: 'error', message: errorMessage(e) })),
        },
      });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const respond = async (response: 'accepted' | 'declined') => {
    try {
      await api.post(`/events/${o.eventId}/response`, { response });
      void series.refetch();
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };

  const reminder = REMINDERS.find((r) => r.value === o.reminderMinutes)?.label;
  return (
    <div className="event-details">
      <p className="event-when">
        <Icon name="clock" size={17} /> {whenText(o, tz)}
      </p>
      {o.createdBy && (
        <p className="event-line event-added-by">
          <AddedBy userId={o.createdBy} full />
          <span className="muted-sm">added this event</span>
        </p>
      )}
      {!o.allDay && o.timezone !== tz && (
        <p className="muted-sm">
          Scheduled in {o.timezone.replace(/_/g, ' ')}: {formatInstant(o.startsAt!, o.timezone, { hour: 'numeric', minute: '2-digit' })} there.
        </p>
      )}
      {o.recurring && (
        <p className="event-line">
          <Icon name="repeat" size={17} /> {describeRecurrence(o.recurrence)}
          {o.isException && <span className="tag">Changed occurrence</span>}
        </p>
      )}
      {o.location && (
        <p className="event-line">
          <Icon name="location" size={17} />
          {/^https?:\/\//.test(o.location) ? (
            <a href={o.location} target="_blank" rel="noreferrer noopener">
              {o.location}
            </a>
          ) : (
            o.location
          )}
        </p>
      )}
      {o.projectId && (
        <p className="event-line">
          <Icon name="projects" size={17} />
          <Link to={`/app/projects/${o.projectId}`} onClick={() => ui.showEvent(null)}>
            {o.projectName}
          </Link>
        </p>
      )}
      {o.reminderMinutes !== null && !o.allDay && (
        <p className="event-line">
          <Icon name="bell" size={17} /> {reminder}
        </p>
      )}
      <p className="event-line">
        <Icon name={o.visibility === 'private' ? 'lock' : 'people'} size={17} /> {o.visibility === 'private' ? 'Private — visible to you and attendees' : 'Visible to the whole team'}
      </p>
      {o.description && <p className="event-desc">{o.description}</p>}

      <section className="task-section">
        <h3 className="task-section-title">People</h3>
        <ul className="attendees">
          {organizer && (
            <li>
              <Avatar member={organizer} size={26} /> {organizer.name} <span className="muted-sm">Organizer · added this event</span>
            </li>
          )}
          {o.attendeeIds
            .filter((id) => id !== o.createdBy)
            .map((id) => {
              const m = members.find((x) => x.id === id);
              const r = series.data?.attendees.find((a) => a.userId === id)?.response;
              return (
                <li key={id}>
                  <Avatar member={m ?? { id, name: 'Former member', avatarUrl: null }} size={26} /> {m?.name ?? 'Former member'}
                  {r && r !== 'pending' && <span className={`muted-sm resp-${r}`}>{r === 'accepted' ? 'Going' : 'Declined'}</span>}
                </li>
              );
            })}
        </ul>
        {isAttendee && o.createdBy !== me.user.id && (
          <div className="rsvp" role="group" aria-label="Your response">
            <span className="muted-sm">Going?</span>
            <Button size="sm" variant={myResponse === 'accepted' ? 'primary' : 'secondary'} onClick={() => void respond('accepted')} aria-pressed={myResponse === 'accepted'}>
              Yes
            </Button>
            <Button size="sm" variant={myResponse === 'declined' ? 'primary' : 'secondary'} onClick={() => void respond('declined')} aria-pressed={myResponse === 'declined'}>
              No
            </Button>
          </div>
        )}
      </section>

      <div className="panel-actions">
        {canDelete && (
          <Button variant="danger" icon="trash" onClick={() => (o.recurring ? setScopeFor('delete') : void remove('series'))} loading={busy && !scopeFor}>
            Delete
          </Button>
        )}
        {canChange && (
          <Button
            variant="primary"
            icon="edit"
            onClick={() => {
              if (o.recurring) setScopeFor('edit');
              else {
                ui.showEvent(null);
                ui.editEvent(o, 'series');
              }
            }}
          >
            Edit
          </Button>
        )}
      </div>
      <ScopeDialog
        open={scopeFor !== null}
        action={scopeFor ?? 'edit'}
        busy={busy}
        onClose={() => setScopeFor(null)}
        onChoose={(scope) => {
          if (scopeFor === 'delete') void remove(scope);
          else {
            setScopeFor(null);
            ui.showEvent(null);
            ui.editEvent(o, scope);
          }
        }}
      />
    </div>
  );
}
