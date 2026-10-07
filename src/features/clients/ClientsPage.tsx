import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Checkbox, EmptyState, Field, Menu, Notice, Skeleton } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { keys, useClients, useProjects } from '../../lib/queries.ts';
import { can, useMeData } from '../shell/me.tsx';
import type { Client, ClientStatus } from '../../../shared/types.ts';

const STATUS_LABEL: Record<ClientStatus, string> = { lead: 'Lead', active: 'Active', past: 'Past' };

export function ClientsPage() {
  const me = useMeData();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [archived, setArchived] = useState(false);
  const q = useClients(archived);
  const projects = useProjects().data ?? [];
  const [editing, setEditing] = useState<Client | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const focus = params.get('client');

  useEffect(() => {
    document.title = 'Clients · Lumera Creative';
  }, []);
  useEffect(() => {
    if (focus && q.data) {
      const c = q.data.find((x) => x.id === focus);
      if (c) setEditing(c);
      setParams({}, { replace: true });
    }
  }, [focus, q.data, setParams]);

  const archive = async (c: Client, value: boolean) => {
    try {
      await api.patch(`/clients/${c.id}`, { archived: value });
      void qc.invalidateQueries({ queryKey: keys.clients });
      toast({ tone: 'info', message: value ? `Archived ${c.name}` : `Restored ${c.name}` });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Relationships</p>
          <h1 className="page-title">Clients</h1>
        </div>
        <div className="page-actions">
          <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New client
          </Button>
        </div>
      </header>
      {q.isError && <Notice tone="danger">{errorMessage(q.error)}</Notice>}
      {q.isPending ? (
        <Skeleton h={160} />
      ) : q.data!.length === 0 ? (
        <div className="card">
          <EmptyState icon="clients" title="No clients yet" action={<Button variant="secondary" icon="plus" onClick={() => setEditing('new')}>Add a client</Button>}>
            Keep contact details and notes for each client, and link their projects and profit.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Status</th>
                <th scope="col">Contact</th>
                <th scope="col">Projects</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((c) => (
                <tr key={c.id} className={c.archived ? 'is-muted' : ''}>
                  <td>
                    <button type="button" className="link-strong" onClick={() => setEditing(c)}>
                      {c.name}
                    </button>
                    {c.website && (
                      <a className="muted-sm table-sub" href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer noopener">
                        {c.website.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${c.status === 'active' ? 'tag-success' : c.status === 'lead' ? 'tag-violet' : ''}`}>{c.archived ? 'Archived' : STATUS_LABEL[c.status]}</span>
                  </td>
                  <td>
                    {c.contactName ?? '—'}
                    {c.contactEmail && (
                      <a className="muted-sm table-sub" href={`mailto:${c.contactEmail}`}>
                        {c.contactEmail}
                      </a>
                    )}
                  </td>
                  <td>
                    {projects.filter((p) => p.clientId === c.id).slice(0, 2).map((p) => (
                      <Link key={p.id} to={`/app/projects/${p.id}`} className="table-sub">
                        {p.name}
                      </Link>
                    ))}
                    {c.projectCount > 2 && <span className="muted-sm">+{c.projectCount - 2} more</span>}
                    {c.projectCount === 0 && <span className="muted-sm">None</span>}
                  </td>
                  <td className="cell-actions">
                    <Menu
                      label={`Actions for ${c.name}`}
                      items={[
                        { label: 'Edit', icon: 'edit', onSelect: () => setEditing(c) },
                        { label: c.archived ? 'Restore' : 'Archive', icon: 'inbox', onSelect: () => void archive(c, !c.archived) },
                        ...(can(me, 'clients.delete') ? [{ label: 'Delete', icon: 'trash' as const, danger: true, onSelect: () => setDeleting(c) }] : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New client' : 'Client'} size="md">
        {editing !== null && <ClientForm key={editing === 'new' ? 'new' : editing.id} client={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete client"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/clients/${deleting!.id}`);
            void qc.invalidateQueries({ queryKey: keys.clients });
            setDeleting(null);
          } catch (err) {
            toast({ tone: 'error', message: errorMessage(err) });
            setDeleting(null);
          }
        }}
      >
        Clients with projects can’t be deleted — archive them instead so history stays intact.
      </ConfirmDialog>
    </div>
  );
}

function ClientForm({ client, onDone }: { client: Client | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: client?.name ?? '',
    contactName: client?.contactName ?? '',
    contactEmail: client?.contactEmail ?? '',
    website: client?.website ?? '',
    notes: client?.notes ?? '',
    status: client?.status ?? ('active' as ClientStatus),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErrors({ name: 'Enter the client’s name.' });
    setBusy(true);
    setErrors({});
    try {
      if (client) await api.patch(`/clients/${client.id}`, f);
      else await api.post('/clients', f);
      void qc.invalidateQueries({ queryKey: keys.clients });
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast({ tone: 'success', message: client ? 'Client saved' : `Added ${f.name}` });
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError) setErrors({ ...err.fields, _: err.message });
      else setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <div className="form-row">
        <Field label="Client name" htmlFor="cl-name" error={errors.name}>
          <input id="cl-name" className="input" value={f.name} onChange={up('name')} maxLength={120} data-autofocus />
        </Field>
        <Field label="Status" htmlFor="cl-status">
          <select id="cl-status" className="select" value={f.status} onChange={up('status')}>
            <option value="lead">Lead</option>
            <option value="active">Active</option>
            <option value="past">Past</option>
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Contact name" htmlFor="cl-contact" optional>
          <input id="cl-contact" className="input" value={f.contactName} onChange={up('contactName')} maxLength={120} />
        </Field>
        <Field label="Contact email" htmlFor="cl-email" optional error={errors.contactEmail}>
          <input id="cl-email" type="email" className="input" value={f.contactEmail} onChange={up('contactEmail')} />
        </Field>
      </div>
      <Field label="Website" htmlFor="cl-web" optional>
        <input id="cl-web" className="input" value={f.website} onChange={up('website')} maxLength={200} placeholder="example.com" />
      </Field>
      <Field label="Notes" htmlFor="cl-notes" optional>
        <textarea id="cl-notes" className="textarea" rows={4} value={f.notes} onChange={up('notes')} maxLength={4000} />
      </Field>
      {errors._ && <Notice tone="danger">{errors._}</Notice>}
      <div className="form-actions">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {client ? 'Save client' : 'Add client'}
        </Button>
      </div>
      {client && (
        <p className="fine-print">
          <Icon name="projects" size={13} /> {client.projectCount} project{client.projectCount === 1 ? '' : 's'} linked.
        </p>
      )}
    </form>
  );
}
