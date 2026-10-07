import { Hono } from 'hono';
import { readJson, readQuery } from '../http.ts';
import type { AppEnv } from '../auth/context.ts';
import { actorOf, tzOf } from './helpers.ts';
import * as svc from '../services/tasks.ts';
import { checklistItemSchema, checklistPatchSchema, checklistTemplateSchema, commentSchema, taskPatchSchema, taskQuerySchema, taskSchema } from '../../shared/schemas.ts';

export const tasks = new Hono<AppEnv>();

tasks.get('/', async (c) => c.json(await svc.listTasks(c.get('org').id, c.get('user').id, tzOf(c), readQuery(c, taskQuerySchema))));

tasks.post('/', async (c) => {
  const input = await readJson(c, taskSchema);
  const r = await svc.createTask(actorOf(c), input);
  return c.json(r, r.duplicate ? 200 : 201);
});

tasks.get('/:id', async (c) => c.json(await svc.getTaskDetail(c.get('org').id, c.req.param('id'))));

tasks.patch('/:id', async (c) => {
  const input = await readJson(c, taskPatchSchema);
  return c.json(await svc.updateTask(actorOf(c), c.req.param('id'), input.changes, input.base, input.force));
});

tasks.delete('/:id', async (c) => {
  await svc.deleteTask(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});

tasks.post('/:id/restore', async (c) => c.json(await svc.restoreTask(actorOf(c), c.req.param('id'))));

tasks.post('/:id/checklist', async (c) => {
  const { title } = await readJson(c, checklistItemSchema);
  return c.json((await svc.addChecklistItems(actorOf(c), c.req.param('id'), [title]))[0], 201);
});

tasks.post('/:id/checklist/template', async (c) => {
  const { templateId } = await readJson(c, checklistTemplateSchema);
  return c.json(await svc.applyChecklistTemplate(actorOf(c), c.req.param('id'), templateId), 201);
});

tasks.patch('/:id/checklist/:itemId', async (c) => {
  const patch = await readJson(c, checklistPatchSchema);
  return c.json(await svc.updateChecklistItem(actorOf(c), c.req.param('id'), c.req.param('itemId'), patch));
});

tasks.delete('/:id/checklist/:itemId', async (c) => {
  await svc.deleteChecklistItem(actorOf(c), c.req.param('id'), c.req.param('itemId'));
  return c.json({ ok: true });
});

tasks.post('/:id/comments', async (c) => {
  const { body } = await readJson(c, commentSchema);
  return c.json(await svc.addComment(actorOf(c), c.req.param('id'), body), 201);
});

tasks.patch('/:id/comments/:commentId', async (c) => {
  const { body } = await readJson(c, commentSchema);
  return c.json(await svc.editComment(actorOf(c), c.req.param('id'), c.req.param('commentId'), body));
});

tasks.delete('/:id/comments/:commentId', async (c) => {
  await svc.deleteComment(actorOf(c), c.req.param('id'), c.req.param('commentId'));
  return c.json({ ok: true });
});
