import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, EmptyState, Field, Menu, Notice } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { invalidateProfit, useMembers, useProfit } from '../../lib/queries.ts';
import { useUI } from '../shell/ui.tsx';
import { can, tzOf, useMeData } from '../shell/me.tsx';
import { GoalCard } from './GoalCard.tsx';
import { formatISO, formatMonth, monthKey, todayIn } from '../../../shared/dates.ts';
import { centsToInput, formatCents, parseMoneyToCents } from '../../../shared/money.ts';
import type { ProfitEntry } from '../../../shared/types.ts';

export function ProfitPage() {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const current = monthKey(todayIn(tzOf(me)));
  const month = params.get('month') ?? current;
  const q = useProfit(month, can(me, 'finance.viewSummary'));
  const members = useMembers().data ?? [];
  const [deleting, setDeleting] = useState<ProfitEntry | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);

  useEffect(() => {
    document.title = 'Profit · Lumera Creative';
  }, []);
  if (!can(me, 'finance.viewSummary')) return <Navigate to="/app" replace />;

  const remove = async (e: ProfitEntry) => {
    try {
      await api.del(`/profit/entries/${e.id}`);
      invalidateProfit(qc);
      setDeleting(null);
      toast({
        tone: 'info',
        message: `Deleted ${formatCents(e.amountCents)} entry`,
        action: { label: 'Undo', onClick: () => void api.post(`/profit/entries/${e.id}/restore`).then(() => invalidateProfit(qc)).catch((err) => toast({ tone: 'error', message: errorMessage(err) })) },
      });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };

  const hist = q.data?.history ?? [];
  const maxBar = Math.max(...hist.map((h) => Math.max(h.recordedCents, h.targetCents)), 1);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Business</p>
          <h1 className="page-title">Profit</h1>
          <p className="page-subtitle">Profit recorded toward the team’s monthly goal. Totals are calculated from saved entries; past months are never reset.</p>
        </div>
        <div className="page-actions">
          {can(me, 'finance.setTarget') && (
            <Button variant="secondary" icon="target" onClick={() => setTargetOpen(true)}>
              Change target
            </Button>
          )}
          {can(me, 'data.export') && (
            <a className="btn btn-ghost btn-md" href="/api/export/profit.csv" download>
              <Icon name="download" size={17} /> <span className="btn-label">Export CSV</span>
            </a>
          )}
        </div>
      </header>

      <div className="profit-layout">
        <GoalCard month={month} onMonth={(m) => setParams(m === current ? {} : { month: m }, { replace: true })} />
        <section className="card" aria-labelledby="hist-title">
          <div className="card-header">
            <h2 className="card-title" id="hist-title">
              <Icon name="chart" size={18} /> Last six months
            </h2>
          </div>
          <div className="card-body">
            <div className="hist" role="list">
              {hist.map((h) => {
                const pct = Math.floor((Math.max(h.recordedCents, 0) * 100) / h.targetCents);
                return (
                  <button
                    type="button"
                    role="listitem"
                    key={h.month}
                    className={`hist-col ${h.month === month ? 'is-selected' : ''}`}
                    onClick={() => setParams(h.month === current ? {} : { month: h.month }, { replace: true })}
                    aria-label={`${formatMonth(h.month)}: ${formatCents(h.recordedCents)} of ${formatCents(h.targetCents)}, ${pct}%`}
                  >
                    <span className="hist-track">
                      <span className="hist-target" style={{ bottom: `${(h.targetCents / maxBar) * 100}%` }} />
                      <span className={`hist-bar ${h.recordedCents >= h.targetCents ? 'is-met' : ''}`} style={{ height: `${(Math.max(h.recordedCents, 0) / maxBar) * 100}%` }} />
                    </span>
                    <span className="hist-label">{formatISO(`${h.month}-01`, { month: 'short' })}</span>
                    <span className="hist-value">{pct}%</span>
                  </button>
                );
              })}
            </div>
            <p className="muted-sm">The line marks each month’s target. Select a month to see its entries.</p>
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="entries-title">
        <div className="card-header">
          <h2 className="card-title" id="entries-title">
            Entries · {formatMonth(month)}
          </h2>
          {can(me, 'finance.record') && (
            <Button size="sm" variant="secondary" icon="plus" onClick={() => ui.openProfitEditor()}>
              Add profit
            </Button>
          )}
        </div>
        {q.isError && <Notice tone="danger">{errorMessage(q.error)}</Notice>}
        {q.data && !q.data.canViewEntries && (
          <div className="card-body">
            <p className="muted-sm">
              <Icon name="lock" size={14} /> Individual entries are visible to owners and admins. You can see the goal progress above.
            </p>
          </div>
        )}
        {q.data?.entries && q.data.entries.length === 0 && (
          <EmptyState icon="profit" title={`No entries for ${formatMonth(month)}`} action={can(me, 'finance.record') ? <Button variant="secondary" icon="plus" onClick={() => ui.openProfitEditor()}>Record profit</Button> : undefined}>
            When a project milestone is paid, record the profit you keep after costs.
          </EmptyState>
        )}
        {q.data?.entries && q.data.entries.length > 0 && (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">
                    Profit
                  </th>
                  <th scope="col">Client / project</th>
                  <th scope="col">Note</th>
                  <th scope="col">Recorded by</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatISO(e.entryDate, { month: 'short', day: 'numeric' })}</td>
                    <td className={`num mono-num ${e.amountCents < 0 ? 'is-negative' : ''}`}>{formatCents(e.amountCents)}</td>
                    <td>
                      {e.clientName ?? '—'}
                      {e.projectName && <span className="muted-sm table-sub">{e.projectName}</span>}
                    </td>
                    <td className="cell-note">{e.note || <span className="muted-sm">—</span>}</td>
                    <td>{members.find((m) => m.id === e.createdBy)?.name ?? 'Former member'}</td>
                    <td className="cell-actions">
                      {can(me, 'finance.edit') && (
                        <Menu
                          label="Entry actions"
                          items={[
                            { label: 'Edit', icon: 'edit', onSelect: () => ui.openProfitEditor(e) },
                            { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDeleting(e) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog open={deleting !== null} title="Delete this entry?" confirmLabel="Delete entry" onClose={() => setDeleting(null)} onConfirm={() => void remove(deleting!)}>
        {deleting && `${formatCents(deleting.amountCents)} on ${formatISO(deleting.entryDate, { month: 'long', day: 'numeric' })} will be removed from the total. You can undo right after.`}
      </ConfirmDialog>
      <TargetDialog open={targetOpen} month={month} currentCents={q.data?.summary.targetCents ?? me.workspace!.defaultTargetCents} onClose={() => setTargetOpen(false)} />
    </div>
  );
}

function TargetDialog({ open, month, currentCents, onClose }: { open: boolean; month: string; currentCents: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(centsToInput(currentCents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(centsToInput(currentCents));
      setError(null);
    }
  }, [open, currentCents]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoneyToCents(value);
    if (!cents || cents < 100) return setError('Enter a target of at least $1.');
    setBusy(true);
    try {
      await api.put('/profit/target', { month, targetCents: cents });
      invalidateProfit(qc);
      toast({ tone: 'success', message: `Target for ${formatMonth(month)} set to ${formatCents(cents)}` });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Change monthly target" size="sm">
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label={`Target for ${formatMonth(month)}`} htmlFor="tg-amount" error={error ?? undefined} hint="Applies to this month and later months that don’t have their own target. Earlier months keep theirs.">
          <div className="input-affix">
            <span className="affix">$</span>
            <input id="tg-amount" className="input mono-num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
          </div>
        </Field>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save target
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
