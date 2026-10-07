import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Button, IconButton, Notice, Skeleton } from '../../components/ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { gsap, skipMotion } from '../../lib/motion.ts';
import { errorMessage } from '../../lib/api.ts';
import { useProfit } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { addMonths, formatMonth, monthKey, todayIn } from '../../../shared/dates.ts';
import { formatCents } from '../../../shared/money.ts';

/** Recorded profit counts up from its previous value (settles instantly under reduced motion). */
function Counter({ cents }: { cents: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    shown.current = cents;
    if (skipMotion() || from === cents) {
      el.textContent = formatCents(cents);
      return;
    }
    const obj = { v: from };
    const tween = gsap.to(obj, { v: cents, duration: 0.9, ease: 'power3.out', onUpdate: () => (el.textContent = formatCents(Math.round(obj.v))) });
    const settle = window.setTimeout(() => {
      tween.kill();
      el.textContent = formatCents(cents);
    }, 1200);
    return () => {
      tween.kill();
      window.clearTimeout(settle);
      el.textContent = formatCents(cents);
    };
  }, [cents]);
  return <span ref={ref}>{formatCents(cents)}</span>;
}

export function GoalCard({ month, onMonth, compact = false }: { month?: string; onMonth?: (m: string) => void; compact?: boolean }) {
  const me = useMeData();
  const ui = useUI();
  const current = monthKey(todayIn(tzOf(me)));
  const m = month ?? current;
  const q = useProfit(m);
  const s = q.data?.summary;
  const bar = s ? Math.min(Math.max(s.recordedCents, 0) / s.targetCents, 1) : 0;
  const overBar = s && s.overCents > 0 ? Math.min(s.overCents / s.targetCents, 1) : 0;

  return (
    <section className={`card goal ${compact ? 'is-compact' : ''}`} aria-labelledby="goal-title">
      <div className="goal-head">
        <div>
          <h2 className="goal-title" id="goal-title">
            Monthly profit goal
          </h2>
          <p className="goal-month">{formatMonth(m)}</p>
        </div>
        {onMonth && (
          <div className="goal-nav">
            <IconButton icon="left" label="Previous month" onClick={() => onMonth(addMonths(m, -1))} />
            <IconButton icon="right" label="Next month" onClick={() => onMonth(addMonths(m, 1))} disabled={m >= current} />
          </div>
        )}
      </div>
      {q.isError ? (
        <Notice tone="danger">{errorMessage(q.error)}</Notice>
      ) : !s ? (
        <div className="stack">
          <Skeleton h={40} w="60%" />
          <Skeleton h={10} />
        </div>
      ) : (
        <>
          <div className="goal-figures">
            <p className="goal-amount">
              <Counter cents={s.recordedCents} />
            </p>
            <p className="goal-of">
              recorded of <strong>{formatCents(s.targetCents)}</strong> target
            </p>
          </div>
          <div
            className={`goal-bar ${s.achieved ? 'is-achieved' : ''}`}
            role="progressbar"
            aria-label={`Profit toward ${formatMonth(m)} target`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(s.percent, 100)}
            aria-valuetext={`${s.percent}% of target, ${formatCents(s.recordedCents)} of ${formatCents(s.targetCents)}`}
          >
            <span className="goal-fill" style={{ width: `${bar * 100}%` }} />
            {overBar > 0 && <span className="goal-over" style={{ width: `${overBar * 30}%` }} aria-hidden="true" />}
          </div>
          <dl className="goal-stats">
            <div>
              <dt>Achieved</dt>
              <dd className="mono-num">{s.percent}%</dd>
            </div>
            <div>
              <dt>{s.achieved ? 'Over target' : 'Remaining'}</dt>
              <dd className="mono-num">{formatCents(s.achieved ? s.overCents : s.remainingCents)}</dd>
            </div>
            <div>
              <dt>Entries</dt>
              <dd className="mono-num">{s.entryCount}</dd>
            </div>
          </dl>
          {s.achieved && (
            <p className="goal-note is-achieved">
              <Icon name="checkFilled" size={15} /> Goal reached{s.overCents > 0 ? ` — ${formatCents(s.overCents)} over` : ''}.
            </p>
          )}
          {s.recordedCents < 0 && <p className="goal-note">Adjustments currently outweigh profit this month.</p>}
          <p className="goal-foot">
            <Icon name="info" size={13} /> Entries record profit, not revenue.
          </p>
          <div className="goal-actions">
            {can(me, 'finance.record') && m <= current && (
              <Button variant="primary" size="sm" icon="plus" onClick={() => ui.openProfitEditor()}>
                Add profit
              </Button>
            )}
            {compact && (
              <Link to="/app/profit" className="btn btn-ghost btn-sm">
                Details
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}
