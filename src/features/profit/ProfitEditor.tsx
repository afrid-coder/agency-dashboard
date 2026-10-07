import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Field, Notice, Segmented, describedBy } from '../../components/ui.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateProfit, useClients, useProjects } from '../../lib/queries.ts';
import { newKey } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { tzOf, useMeData } from '../shell/me.tsx';
import { todayIn } from '../../../shared/dates.ts';
import { centsToInput, formatCents, parseMoneyToCents } from '../../../shared/money.ts';
import type { ProfitEntry } from '../../../shared/types.ts';

export function ProfitEditor() {
  const ui = useUI();
  const ed = ui.profitEditor;
  return (
    <Dialog open={Boolean(ed)} onClose={ui.closeProfitEditor} title={ed?.entry ? 'Edit profit entry' : 'Add profit'} subtitle="Record profit — what the agency keeps after costs — not revenue." size="sm">
      {ed && <EntryForm key={ed.entry?.id ?? 'new'} entry={ed.entry} projectId={ed.projectId ?? null} />}
    </Dialog>
  );
}

function EntryForm({ entry, projectId: presetProject }: { entry: ProfitEntry | null; projectId: string | null }) {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useClients().data ?? [];
  const projects = useProjects().data ?? [];
  const [kind, setKind] = useState<'profit' | 'adjustment'>(entry && entry.amountCents < 0 ? 'adjustment' : 'profit');
  const [amount, setAmount] = useState(entry ? centsToInput(Math.abs(entry.amountCents)) : '');
  const [date, setDate] = useState(entry?.entryDate ?? todayIn(tzOf(me)));
  const [projectId, setProjectId] = useState(entry?.projectId ?? presetProject ?? '');
  const [clientId, setClientId] = useState(entry?.clientId ?? projects.find((p) => p.id === presetProject)?.clientId ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);

  const submit = async (e: FormEvent | null, confirmDuplicate = false) => {
    e?.preventDefault();
    const cents = parseMoneyToCents(amount);
    const errs: Record<string, string> = {};
    if (cents === null || cents === 0) errs.amount = 'Enter an amount like 250 or 1,250.50.';
    else if (cents > 100_000_000) errs.amount = 'Entries are limited to $1,000,000.';
    if (!date) errs.date = 'Choose the date the profit was earned.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const signed = kind === 'adjustment' ? -cents! : cents!;
    const body = { amountCents: signed, entryDate: date, clientId: clientId || null, projectId: projectId || null, note: note.trim() };
    setBusy(true);
    setFormError(null);
    try {
      if (entry) await api.patch(`/profit/entries/${entry.id}`, { version: entry.version, changes: body });
      else await api.post('/profit/entries', { ...body, idempotencyKey: key, confirmDuplicate });
      invalidateProfit(qc);
      ui.closeProfitEditor();
      toast({ tone: 'success', message: entry ? 'Entry updated' : `Recorded ${formatCents(signed)} ${kind === 'adjustment' ? 'adjustment' : 'profit'}` });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'possible_duplicate') setDuplicate(err.message);
      else {
        if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const visibleProjects = projects.filter((p) => !clientId || p.clientId === clientId || p.id === projectId);
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)} noValidate>
      <Segmented
        label="Entry type"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'profit', label: 'Profit' },
          { value: 'adjustment', label: 'Adjustment (−)' },
        ]}
      />
      <Field label={kind === 'adjustment' ? 'Amount to subtract' : 'Profit amount'} htmlFor="pf-amount" error={errors.amount} hint={kind === 'adjustment' ? 'Use adjustments for refunds, write-offs or corrections.' : undefined}>
        <div className="input-affix">
          <span className="affix">{kind === 'adjustment' ? '−$' : '$'}</span>
          <input id="pf-amount" className="input mono-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-autofocus aria-invalid={Boolean(errors.amount) || undefined} aria-describedby={describedBy('pf-amount', errors.amount, kind === 'adjustment' ? 'x' : undefined)} />
        </div>
      </Field>
      <Field label="Date" htmlFor="pf-date" error={errors.entryDate ?? errors.date}>
        <input id="pf-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Client" htmlFor="pf-client" optional>
        <select id="pf-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">No client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Project" htmlFor="pf-project" optional>
        <select
          id="pf-project"
          className="select"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            const p = projects.find((x) => x.id === e.target.value);
            if (p?.clientId) setClientId(p.clientId);
          }}
        >
          <option value="">No project</option>
          {visibleProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note" htmlFor="pf-note" optional>
        <input id="pf-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Launch milestone, net of hosting" />
      </Field>
      {duplicate && (
        <Notice
          tone="warning"
          action={
            <Button size="sm" variant="primary" onClick={() => void submit(null, true)} loading={busy}>
              Add anyway
            </Button>
          }
        >
          {duplicate}
        </Notice>
      )}
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="form-actions">
        <Button variant="ghost" onClick={ui.closeProfitEditor}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy && !duplicate}>
          {entry ? 'Save entry' : 'Record profit'}
        </Button>
      </div>
    </form>
  );
}
