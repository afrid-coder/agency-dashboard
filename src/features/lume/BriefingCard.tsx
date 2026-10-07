import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Notice, Segmented, Skeleton } from '../../components/ui.tsx';
import { Icon, LumeMark } from '../../lib/icons.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { keys, useBriefing } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { LumeText, RecordChip } from './LumeText.tsx';
import { formatISO, formatInstant } from '../../../shared/dates.ts';
import { formatCents } from '../../../shared/money.ts';
import type { Briefing } from '../../../shared/types.ts';

export function BriefingCard() {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const tz = tzOf(me);
  const [scope, setScope] = useState<'personal' | 'team'>('personal');
  const q = useBriefing(scope);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const b = q.data;

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fresh = await api.get<Briefing>(`/lume/briefing?scope=${scope}&refresh=1`);
      qc.setQueryData([...keys.briefing, scope], fresh);
    } catch (err) {
      setRefreshError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const f = b?.facts;
  const nothing = f && f.meetings.length === 0 && f.dueToday.length === 0 && f.overdue.length === 0 && f.deadlines.length === 0;

  return (
    <section className="card briefing" aria-labelledby="briefing-title" aria-busy={q.isPending || refreshing}>
      <header className="briefing-head">
        <span className="briefing-mark">
          <LumeMark size={20} active={q.isFetching || refreshing} />
        </span>
        <div>
          <h2 className="briefing-title" id="briefing-title">
            Your day with Lume
          </h2>
          <p className="briefing-when">
            {b ? (
              <>
                {b.demo && <span className="tag tag-xs">Demo response</span>} Updated {formatInstant(b.generatedAt, tz, { hour: 'numeric', minute: '2-digit' })} · {formatISO(b.day, { weekday: 'long', month: 'short', day: 'numeric' })}
              </>
            ) : (
              'Preparing your briefing…'
            )}
          </p>
        </div>
        <div className="briefing-actions">
          {can(me, 'lume.teamBriefing') && (
            <Segmented
              label="Briefing scope"
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'personal', label: 'You' },
                { value: 'team', label: 'Team' },
              ]}
            />
          )}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refresh()} loading={refreshing} aria-label="Refresh briefing">
            <span className="hide-sm">Refresh</span>
          </Button>
        </div>
      </header>

      {q.isPending && (
        <div className="stack">
          <Skeleton h={18} />
          <Skeleton h={18} w="80%" />
          <Skeleton h={60} />
        </div>
      )}
      {q.isError && (
        <Notice tone="danger" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>
          {errorMessage(q.error)}
        </Notice>
      )}
      {refreshError && <Notice tone="danger">{refreshError}</Notice>}

      {b && (
        <div className="briefing-body">
          <div className="briefing-main">
            {b.aiError ? (
              <Notice tone={me.lume.mode === 'unconfigured' ? 'info' : 'warning'}>{b.aiError}</Notice>
            ) : (
              <LumeText text={b.summary} refs={b.priorities.flatMap((p) => p.refs)} />
            )}
            {b.priorities.length > 0 && (
              <div className="briefing-priorities">
                <p className="mono-label">
                  Suggested priorities <span className="sr-only">(suggestions, not records)</span>
                </p>
                <ol>
                  {b.priorities.map((p, i) => (
                    <li key={i}>
                      <LumeText text={p.text} refs={p.refs} />
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {nothing && (
              <div className="briefing-quiet">
                <p>{scope === 'personal' ? 'Nothing is scheduled or due for you today.' : 'The team has nothing scheduled or due today.'} A good moment to plan ahead.</p>
                <div className="row-gap">
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openNewTask({ assigneeIds: [me.user.id] })}>
                    Add a task
                  </Button>
                  {me.lume.mode !== 'unconfigured' && (
                    <Button size="sm" variant="ghost" leading={<LumeMark size={14} />} onClick={() => ui.openLume('Help me prepare a weekly agenda.')}>
                      Plan my week
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          <dl className="briefing-facts">
            <div>
              <dt>
                <Icon name="calendar" size={15} /> Meetings today
              </dt>
              <dd>
                {f!.meetings.length === 0 ? (
                  <span className="muted-sm">None</span>
                ) : (
                  <ul>
                    {f!.meetings.slice(0, 4).map((o) => (
                      <li key={o.key}>
                        <button type="button" className="fact-link" onClick={() => ui.showEvent(o)}>
                          <span className="fact-time">{o.allDay ? 'All day' : formatInstant(o.startsAt!, tz, { hour: 'numeric', minute: '2-digit' })}</span> {o.title}
                        </button>
                      </li>
                    ))}
                    {f!.meetings.length > 4 && <li className="muted-sm">+{f!.meetings.length - 4} more</li>}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <Icon name="tasks" size={15} /> Due today
              </dt>
              <dd>
                {f!.dueToday.length === 0 ? (
                  <span className="muted-sm">Nothing due</span>
                ) : (
                  <ul>
                    {f!.dueToday.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <RecordChip r={{ type: 'task', id: t.id, title: t.title, href: `/app/tasks?task=${t.id}` }} />
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className={f!.overdue.length ? 'is-alert' : ''}>
                <Icon name="warning" size={15} /> Overdue
              </dt>
              <dd>
                {f!.overdue.length === 0 ? (
                  <span className="muted-sm">All on track</span>
                ) : (
                  <ul>
                    {f!.overdue.slice(0, 3).map((t) => (
                      <li key={t.id}>
                        <RecordChip r={{ type: 'task', id: t.id, title: t.title, href: `/app/tasks?task=${t.id}` }} />
                      </li>
                    ))}
                    {f!.overdue.length > 3 && <li className="muted-sm">+{f!.overdue.length - 3} more</li>}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <Icon name="flag" size={15} /> Coming up
              </dt>
              <dd>
                {f!.deadlines.length === 0 ? (
                  <span className="muted-sm">No deadlines this week</span>
                ) : (
                  <ul>
                    {f!.deadlines.slice(0, 3).map((d) => (
                      <li key={`${d.type}:${d.id}`}>
                        <span className="fact-time">{formatISO(d.date, { weekday: 'short' })}</span> <RecordChip r={{ type: d.type, id: d.id, title: d.title, href: d.href }} />
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {f!.profit && (
              <div>
                <dt>
                  <Icon name="profit" size={15} /> Profit goal
                </dt>
                <dd>
                  <span className="mono-num">{formatCents(f!.profit.recordedCents)}</span> of {formatCents(f!.profit.targetCents)} · {f!.profit.percent}%
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}
