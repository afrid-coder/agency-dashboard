import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, IconButton, Notice, Skeleton } from '../../components/ui.tsx';
import { AddedBy } from '../../components/AddedBy.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Icon } from '../../lib/icons.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { keys, useMembers, useNotes } from '../../lib/queries.ts';
import { relativeTime } from '../../lib/format.ts';
import { useUI } from '../shell/ui.tsx';
import { useMeData } from '../shell/me.tsx';
import type { Note } from '../../../shared/types.ts';

export function NotesPage() {
  const me = useMeData();
  const ui = useUI();
  const members = useMembers().data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const author = params.get('by') ?? '';
  const notes = useNotes(search);

  useEffect(() => {
    document.title = 'Notes · Lumera Creative';
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  // Open a note linked from elsewhere (?note=…), for example from Lume.
  const linked = params.get('note');
  useEffect(() => {
    if (!linked || !notes.data) return;
    const match = notes.data.find((n) => n.id === linked);
    if (match) ui.openNote(match);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('note');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, notes.data]);

  const shown = useMemo(() => (notes.data ?? []).filter((n) => !author || n.createdBy === author), [notes.data, author]);

  return (
    <div className="page notes-page">
      <header className="page-header">
        <div className="page-header-text">
          <p className="mono-label">Shared with the team</p>
          <h1 className="page-title">Notes</h1>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon="plus" onClick={() => ui.openNote()}>
            New note
          </Button>
        </div>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        <div className="search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="note-search">
            Search notes
          </label>
          <input id="note-search" className="input" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="note-author">
          Written by
        </label>
        <select
          id="note-author"
          className="select select-sm"
          value={author}
          onChange={(e) =>
            setParams(
              (prev) => {
                const p = new URLSearchParams(prev);
                if (e.target.value) p.set('by', e.target.value);
                else p.delete('by');
                return p;
              },
              { replace: true },
            )
          }
        >
          <option value="">Everyone’s notes</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === me.user.id ? 'My notes' : `${m.name}’s notes`}
            </option>
          ))}
        </select>
      </div>

      {notes.error && (
        <Notice tone="danger" action={<Button size="sm" onClick={() => void notes.refetch()}>Retry</Button>}>
          {errorMessage(notes.error)}
        </Notice>
      )}
      {notes.isPending && (
        <div className="note-grid">
          <Skeleton h={140} r={12} />
          <Skeleton h={140} r={12} />
          <Skeleton h={140} r={12} />
        </div>
      )}
      {notes.data && shown.length === 0 && (
        <div className="card">
          {search || author ? (
            <EmptyState icon="search" title="No matching notes">
              Try other words, or show everyone’s notes.
            </EmptyState>
          ) : (
            <EmptyState icon="notes" title="No notes yet" action={<Button variant="secondary" icon="plus" onClick={() => ui.openNote()}>Write the first note</Button>}>
              Jot down ideas, call notes and reminders. Everyone in the workspace sees them, with the name of whoever wrote each one.
            </EmptyState>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="note-grid" aria-label="Notes">
          {shown.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NoteCard({ note, compact = false }: { note: Note; compact?: boolean }) {
  const ui = useUI();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const heading = note.title || note.body.split('\n').find((l) => l.trim())?.trim() || 'Untitled';
  const text = note.title ? note.body : note.body.slice(note.body.indexOf(heading) + heading.length);
  const edited = note.updatedBy && note.updatedBy !== note.createdBy;

  const togglePin = async () => {
    setBusy(true);
    try {
      await api.patch(`/notes/${note.id}`, { version: note.version, pinned: !note.pinned });
      void qc.invalidateQueries({ queryKey: keys.notes });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) });
      void qc.invalidateQueries({ queryKey: keys.notes });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`note-card ${note.pinned ? 'is-pinned' : ''} ${compact ? 'is-compact' : ''}`}>
      <button type="button" className="note-card-open" onClick={() => ui.openNote(note)} aria-label={`Open note: ${heading}`} />
      <div className="note-card-head">
        <h3 className="note-card-title">{heading}</h3>
        {!compact && (
          <IconButton icon="pin" size="sm" label={note.pinned ? 'Unpin note' : 'Pin note'} className={`note-pin ${note.pinned ? 'is-on' : ''}`} aria-pressed={note.pinned} onClick={() => void togglePin()} disabled={busy} />
        )}
        {compact && note.pinned && <Icon name="pin" size={14} className="note-pin-mark" />}
      </div>
      {text.trim() && <p className="note-card-body">{text.trim()}</p>}
      <footer className="note-card-foot">
        <AddedBy userId={note.createdBy} at={note.createdAt} full={!compact} />
        <span className="muted-sm">
          {edited ? (
            <>
              edited by <AddedBy userId={note.updatedBy} variant="text" verb="" /> · {relativeTime(note.updatedAt)}
            </>
          ) : (
            relativeTime(note.createdAt)
          )}
        </span>
      </footer>
    </article>
  );
}
