// Shared team notes. Everyone in the workspace can read, write and edit them;
// each note keeps who wrote it and who last changed it. Edits carry the
// version they started from, so nobody silently overwrites a teammate.
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db, isUniqueViolation, schema } from '../db/client.ts';
import { ApiError, forbidden, notFound } from '../http.ts';
import { logActivity } from './activity.ts';
import { publish } from '../realtime.ts';
import type { Actor } from './tasks.ts';
import type { Note } from '../../shared/types.ts';

const N = schema.notes;

const toNote = (r: typeof N.$inferSelect): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  pinned: r.pinned,
  createdBy: r.createdBy,
  updatedBy: r.updatedBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

/** A short name for activity lines: the title, or the start of the text. */
const label = (n: { title: string; body: string }) => {
  const text = (n.title || n.body).replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/** Pinned first, then most recently changed. */
export async function listNotes(orgId: string, opts: { q?: string; limit?: number } = {}): Promise<Note[]> {
  const conds = [eq(N.orgId, orgId)];
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(N.title, like), ilike(N.body, like))!);
  }
  const rows = await db
    .select()
    .from(N)
    .where(and(...conds))
    .orderBy(desc(N.pinned), desc(N.updatedAt))
    .limit(Math.min(opts.limit ?? 200, 500));
  return rows.map(toNote);
}

export async function getNote(orgId: string, id: string): Promise<Note> {
  const [row] = await db.select().from(N).where(and(eq(N.orgId, orgId), eq(N.id, id)));
  if (!row) throw notFound('That note');
  return toNote(row);
}

export async function createNote(actor: Actor, input: { title: string; body: string; pinned: boolean; idempotencyKey?: string }): Promise<Note> {
  try {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(N)
        .values({ orgId: actor.orgId, title: input.title, body: input.body, pinned: input.pinned, idempotencyKey: input.idempotencyKey ?? null, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'created', entityType: 'note', entityId: r.id, summary: `added a note: ${label(r)}` });
      return r;
    });
    publish(actor.orgId, { topics: ['notes', 'activity'], actorId: actor.userId });
    return toNote(row);
  } catch (err) {
    // A retried request (same idempotency key) returns the note it already created.
    if (input.idempotencyKey && isUniqueViolation(err, 'note_idempotency_uq')) {
      const [existing] = await db.select().from(N).where(and(eq(N.orgId, actor.orgId), eq(N.idempotencyKey, input.idempotencyKey)));
      if (existing) return toNote(existing);
    }
    throw err;
  }
}

export async function updateNote(actor: Actor, id: string, patch: { version: number; title?: string; body?: string; pinned?: boolean }): Promise<Note> {
  const current = await getNote(actor.orgId, id);
  if (current.version !== patch.version) {
    throw new ApiError(409, 'conflict', 'Someone changed this note while you were editing it.', { details: { note: current } });
  }
  const next = { title: patch.title ?? current.title, body: patch.body ?? current.body };
  if (!next.title.trim() && !next.body.trim()) throw new ApiError(422, 'invalid', 'A note can’t be empty. Delete it instead.', { fields: { body: 'Write something in the note first.' } });
  const contentChanged = next.title !== current.title || next.body !== current.body;
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(N)
      .set({
        ...next,
        pinned: patch.pinned ?? current.pinned,
        version: current.version + 1,
        // Pinning isn't an edit: the note keeps its author, editor and place in the list.
        ...(contentChanged ? { updatedBy: actor.userId, updatedAt: new Date() } : {}),
      })
      .where(and(eq(N.orgId, actor.orgId), eq(N.id, id), eq(N.version, current.version)))
      .returning();
    if (!r) return null;
    if (contentChanged) await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'updated', entityType: 'note', entityId: id, summary: `edited the note ${label(r)}` });
    else if (patch.pinned !== undefined && patch.pinned !== current.pinned)
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: patch.pinned ? 'pinned' : 'unpinned', entityType: 'note', entityId: id, summary: `${patch.pinned ? 'pinned' : 'unpinned'} the note ${label(r)}` });
    return r;
  });
  if (!row) throw new ApiError(409, 'conflict', 'Someone changed this note while you were editing it.', { details: { note: await getNote(actor.orgId, id) } });
  publish(actor.orgId, { topics: ['notes', 'activity'], actorId: actor.userId });
  return toNote(row);
}

/** The author, or an owner or admin, can delete a note. */
export async function deleteNote(actor: Actor, id: string) {
  const note = await getNote(actor.orgId, id);
  if (note.createdBy !== actor.userId && !actor.canDeleteAny) throw forbidden('Only the person who wrote this note, or an owner or admin, can delete it.');
  await db.transaction(async (tx) => {
    await tx.delete(N).where(and(eq(N.orgId, actor.orgId), eq(N.id, id)));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'note', entityId: id, summary: `deleted the note ${label(note)}` });
  });
  publish(actor.orgId, { topics: ['notes', 'activity'], actorId: actor.userId });
}
