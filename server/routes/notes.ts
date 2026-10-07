import { Hono } from 'hono';
import { readJson } from '../http.ts';
import type { AppEnv } from '../auth/context.ts';
import { actorOf } from './helpers.ts';
import * as svc from '../services/notes.ts';
import { notePatchSchema, noteSchema } from '../../shared/schemas.ts';

export const notes = new Hono<AppEnv>();

notes.get('/', async (c) => c.json(await svc.listNotes(c.get('org').id, { q: c.req.query('q')?.slice(0, 100), limit: Number(c.req.query('limit')) || undefined })));
notes.post('/', async (c) => c.json(await svc.createNote(actorOf(c), await readJson(c, noteSchema)), 201));
notes.get('/:id', async (c) => c.json(await svc.getNote(c.get('org').id, c.req.param('id'))));
notes.patch('/:id', async (c) => c.json(await svc.updateNote(actorOf(c), c.req.param('id'), await readJson(c, notePatchSchema))));
notes.delete('/:id', async (c) => {
  await svc.deleteNote(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});
