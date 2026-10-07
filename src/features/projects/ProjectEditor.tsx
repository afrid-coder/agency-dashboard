import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Checkbox, Field, Notice, describedBy } from '../../components/ui.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiRequestError, errorMessage } from '../../lib/api.ts';
import { invalidateWork, keys, useClients, useMembers } from '../../lib/queries.ts';
import { newKey } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { STAGES, STAGE_TEMPLATES, type Stage } from '../../../shared/templates.ts';
import type { Project, ProjectStatus } from '../../../shared/types.ts';

export const PROJECT_STATUS: { value: ProjectStatus; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];
export const COLORS = ['violet', 'teal', 'amber', 'rose', 'slate', 'olive'] as const;

export function ProjectEditor() {
  const ui = useUI();
  const ed = ui.projectEditor;
  return (
    <Dialog open={Boolean(ed)} onClose={ui.closeProjectEditor} title={ed?.project ? 'Edit project' : 'New project'} size="md">
      {ed && <ProjectForm key={ed.project?.id ?? 'new'} project={ed.project} />}
    </Dialog>
  );
}

function ProjectForm({ project }: { project: Project | null }) {
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const clients = useClients().data ?? [];
  const members = useMembers().data ?? [];
  const [name, setName] = useState(project?.name ?? '');
  const [clientChoice, setClientChoice] = useState(project?.clientId ?? '');
  const [newClient, setNewClient] = useState('');
  const [stage, setStage] = useState<Stage>(project?.stage ?? 'discovery');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active');
  const [leadId, setLeadId] = useState(project?.leadId ?? '');
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '');
  const [color, setColor] = useState(project?.color ?? 'violet');
  const [description, setDescription] = useState(project?.description ?? '');
  const [templates, setTemplates] = useState<Stage[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const starterCount = templates.reduce((n, s) => n + STAGE_TEMPLATES[s].length, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name the project.';
    if (clientChoice === '__new' && !newClient.trim()) errs.newClient = 'Enter the new client’s name.';
    if (startDate && dueDate && dueDate < startDate) errs.dueDate = 'The due date must be on or after the start date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError(null);
    const fields = {
      name: name.trim(),
      description: description.trim() || null,
      clientId: clientChoice && clientChoice !== '__new' ? clientChoice : null,
      stage,
      status,
      leadId: leadId || null,
      startDate: startDate || null,
      dueDate: dueDate || null,
      color,
    };
    try {
      if (project) {
        const base = { name: project.name, description: project.description, clientId: project.clientId, stage: project.stage, status: project.status, leadId: project.leadId, startDate: project.startDate, dueDate: project.dueDate, color: project.color };
        await api.patch(`/projects/${project.id}`, { changes: fields, base });
        toast({ tone: 'success', message: 'Project saved' });
      } else {
        const res = await api.post<{ project: Project; tasksCreated: number }>('/projects', { ...fields, templates, newClientName: clientChoice === '__new' ? newClient.trim() : undefined, idempotencyKey: key });
        toast({ tone: 'success', message: `Created ${res.project.name}${res.tasksCreated ? ` with ${res.tasksCreated} starter tasks` : ''}` });
        navigate(`/app/projects/${res.project.id}`);
      }
      invalidateWork(qc);
      void qc.invalidateQueries({ queryKey: keys.clients });
      ui.closeProjectEditor();
    } catch (err) {
      if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Field label="Project name" htmlFor="pj-name" error={errors.name}>
        <input id="pj-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus aria-invalid={Boolean(errors.name) || undefined} aria-describedby={describedBy('pj-name', errors.name)} placeholder="e.g. Harbor Dental website redesign" />
      </Field>
      <div className="form-row">
        <Field label="Client" htmlFor="pj-client" optional>
          <select id="pj-client" className="select" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
            <option value="">Internal / no client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {!project && <option value="__new">+ New client…</option>}
          </select>
        </Field>
        {clientChoice === '__new' ? (
          <Field label="New client name" htmlFor="pj-newclient" error={errors.newClient ?? errors.name}>
            <input id="pj-newclient" className="input" value={newClient} onChange={(e) => setNewClient(e.target.value)} maxLength={120} autoFocus />
          </Field>
        ) : (
          <Field label="Lead" htmlFor="pj-lead" optional>
            <select id="pj-lead" className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">No lead</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {clientChoice === '__new' && (
        <Field label="Lead" htmlFor="pj-lead2" optional>
          <select id="pj-lead2" className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">No lead</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-row">
        <Field label="Stage" htmlFor="pj-stage">
          <select id="pj-stage" className="select" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="pj-status">
          <select id="pj-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Start date" htmlFor="pj-start" optional>
          <input id="pj-start" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Due date" htmlFor="pj-due" optional error={errors.dueDate}>
          <input id="pj-due" type="date" className="input" value={dueDate} min={startDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <fieldset className="color-picks">
        <legend className="field-label">Colour</legend>
        {COLORS.map((c) => (
          <label key={c} className={`color-pick c-${c}`}>
            <input type="radio" name="pj-color" value={c} checked={color === c} onChange={() => setColor(c)} />
            <span className="sr-only">{c}</span>
          </label>
        ))}
      </fieldset>
      <Field label="Description" htmlFor="pj-desc" optional>
        <textarea id="pj-desc" className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} placeholder="Scope, goals, links to briefs" />
      </Field>
      {!project && (
        <fieldset className="starter">
          <legend className="field-label">Starter tasks (optional)</legend>
          <p className="field-hint">Add a practical checklist for each stage you choose. Tasks are assigned to the lead{startDate ? ' and dated from the start date' : ''}; you can change anything afterwards.</p>
          <div className="starter-grid">
            {STAGES.map((s) => (
              <Checkbox
                key={s.value}
                checked={templates.includes(s.value)}
                onChange={(on) => setTemplates((t) => (on ? [...t, s.value] : t.filter((x) => x !== s.value)))}
                label={
                  <span>
                    {s.label} <span className="muted-sm">{STAGE_TEMPLATES[s.value].length} tasks</span>
                  </span>
                }
              />
            ))}
          </div>
          {starterCount > 0 && <p className="muted-sm">{starterCount} tasks will be created.</p>}
        </fieldset>
      )}
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="form-actions">
        <Button variant="ghost" onClick={ui.closeProjectEditor}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {project ? 'Save project' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
