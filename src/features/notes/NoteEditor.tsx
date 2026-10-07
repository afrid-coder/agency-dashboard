import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, Checkbox, Field, Notice, describedBy } from '../../components/ui.tsx';
import { ConfirmDialog } from '../../components/extras.tsx';
import { AddedBy } from '../../components/AddedBy.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiRequestError, api, errorMessage } from '../../lib/api.ts';
import { keys } from '../../lib/queries.ts';
import { newKey } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { can, useMeData } from '../shell/me.tsx';
import type { Note } from '../../../shared/types.ts';

export function NoteEditor() {
  const ui = useUI();
  const ed = ui.noteEditor;
  return (
    <Dialog open={Boolean(ed)} onClose={ui.closeNote} title={ed?.note ? 'Edit note' : 'New note'} subtitle="Everyone in the workspace can see and edit team notes." size="md" initialFocus={ed?.note ? '#note-body' : '#note-title'}>
      {ed && <NoteForm key={ed.note?.id ?? 'new'} note={ed.note} />}
    </Dialog>
  );
}

function NoteForm({ note }: { note: Note | null }) {
  const me = useMeData();
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const [base, setBase] = useState(note);
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key] = useState(newKey);
  const canDelete = base && (base.createdBy === me.user.id || can(me, 'tasks.deleteAny'));

  const save = async (e: FormEvent | null, version = base?.version) => {
    e?.preventDefault();
    if (!title.trim() && !body.trim()) return setErrors({ body: 'Write something in the note first.' });
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      if (base) await api.patch(`/notes/${base.id}`, { version, title: title.trim(), body, pinned });
      else await api.post('/notes', { title: title.trim(), body, pinned, idempotencyKey: key });
      void qc.invalidateQueries({ queryKey: keys.notes });
      ui.closeNote();
      toast({ tone: 'success', message: base ? 'Note saved' : 'Note added for the team' });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'conflict') setConflict((err.details as { note?: Note } | undefined)?.note ?? null);
      else {
        if (err instanceof ApiRequestError && Object.keys(err.fields).length) setErrors(err.fields);
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const loadTheirs = () => {
    if (!conflict) return;
    setBase(conflict);
    setTitle(conflict.title);
    setBody(conflict.body);
    setPinned(conflict.pinned);
    setConflict(null);
  };

  const remove = async () => {
    if (!base) return;
    setBusy(true);
    try {
      await api.del(`/notes/${base.id}`);
      void qc.invalidateQueries({ queryKey: keys.notes });
      setConfirmDelete(false);
      ui.closeNote();
      toast({ tone: 'success', message: 'Note deleted' });
    } catch (err) {
      setConfirmDelete(false);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid note-form" onSubmit={(e) => void save(e)} noValidate>
      {base && (
        <p className="note-form-meta">
          <AddedBy userId={base.createdBy} at={base.createdAt} variant="text" verb="Written by" full />
          {base.updatedBy && base.updatedBy !== base.createdBy && <AddedBy userId={base.updatedBy} at={base.updatedAt} variant="text" verb="Last edited by" full />}
        </p>
      )}
      <Field label="Title" htmlFor="note-title" optional error={errors.title}>
        <input id="note-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Harbor pitch — ideas" />
      </Field>
      <Field label="Note" htmlFor="note-body" error={errors.body}>
        <textarea
          id="note-body"
          className="textarea note-textarea"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={20000}
          placeholder="Ideas, call notes, links, reminders for your partner…"
          aria-invalid={Boolean(errors.body) || undefined}
          aria-describedby={describedBy('note-body', errors.body)}
        />
      </Field>
      <Checkbox checked={pinned} onChange={setPinned} label="Pin to the top of Notes" />
      {conflict && (
        <Notice
          tone="warning"
          action={
            <span className="notice-actions">
              <Button size="sm" variant="secondary" onClick={loadTheirs}>
                Load their version
              </Button>
              <Button size="sm" variant="primary" onClick={() => void save(null, conflict.version)} loading={busy}>
                Save mine instead
              </Button>
            </span>
          }
        >
          <AddedBy userId={conflict.updatedBy} variant="text" verb="Just edited by" full />. Load their version, or save yours over it.
        </Notice>
      )}
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="form-actions">
        {canDelete && (
          <Button variant="ghost" icon="trash" className="form-actions-start" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        <Button variant="ghost" onClick={ui.closeNote}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy && !conflict}>
          {base ? 'Save note' : 'Add note'}
        </Button>
      </div>
      <ConfirmDialog open={confirmDelete} title="Delete this note?" confirmLabel="Delete note" onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)} busy={busy}>
        It will be removed for everyone in the workspace. This can’t be undone.
      </ConfirmDialog>
    </form>
  );
}
