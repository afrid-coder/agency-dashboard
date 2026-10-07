import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../http.ts';
import { assertCan, permCtx, type AppEnv } from '../auth/context.ts';
import { actorOf, todayOf, tzOf } from './helpers.ts';
import * as svc from '../services/projects.ts';
import { listOccurrences } from '../services/events.ts';
import { projectProfit } from '../services/profit.ts';
import { can } from '../../shared/permissions.ts';
import { addDays } from '../../shared/dates.ts';
import { clientPatchSchema, clientSchema, projectPatchSchema, projectSchema } from '../../shared/schemas.ts';
import type { ProjectDetail } from '../../shared/types.ts';

export const projects = new Hono<AppEnv>();

projects.get('/', async (c) => c.json(await svc.listProjects(c.get('org').id, tzOf(c), { status: c.req.query('status'), clientId: c.req.query('clientId') })));

projects.post('/', async (c) => {
  const input = await readJson(c, projectSchema.and(z.object({ idempotencyKey: z.string().min(8).max(80).optional() })));
  return c.json(await svc.createProject(actorOf(c), tzOf(c), input), 201);
});

projects.get('/:id', async (c) => {
  const orgId = c.get('org').id;
  const p = await svc.getProject(orgId, tzOf(c), c.req.param('id'));
  const today = todayOf(c);
  const [events, profitCents] = await Promise.all([
    listOccurrences(orgId, c.get('user').id, { from: today, to: addDays(today, 45), tz: tzOf(c), scope: 'team', projectId: p.id }),
    can(permCtx(c), 'finance.viewEntries') ? projectProfit(orgId, p.id) : Promise.resolve(null),
  ]);
  const detail: ProjectDetail = { ...p, upcomingEvents: events.slice(0, 12), profitCents };
  return c.json(detail);
});

projects.patch('/:id', async (c) => {
  const input = await readJson(c, projectPatchSchema);
  return c.json(await svc.updateProject(actorOf(c), tzOf(c), c.req.param('id'), input.changes, input.base));
});

projects.delete('/:id', async (c) => {
  assertCan(c, 'projects.delete', 'Only owners and admins can delete projects. You can archive it instead.');
  await svc.deleteProject(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});

export const clients = new Hono<AppEnv>();

clients.get('/', async (c) => c.json(await svc.listClients(c.get('org').id, c.req.query('archived') === '1')));
clients.post('/', async (c) => c.json(await svc.createClient(actorOf(c), await readJson(c, clientSchema)), 201));
clients.patch('/:id', async (c) => c.json(await svc.updateClient(actorOf(c), c.req.param('id'), await readJson(c, clientPatchSchema))));
clients.delete('/:id', async (c) => {
  assertCan(c, 'clients.delete', 'Only owners and admins can delete clients. You can archive the client instead.');
  await svc.deleteClient(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});
