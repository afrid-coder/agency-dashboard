import { Hono } from 'hono';
import { readJson } from '../http.ts';
import { assertCan, permCtx, type AppEnv } from '../auth/context.ts';
import { actorOf, todayOf } from './helpers.ts';
import * as svc from '../services/profit.ts';
import { can } from '../../shared/permissions.ts';
import { monthKey } from '../../shared/dates.ts';
import { monthSchema, profitEntrySchema, profitPatchSchema, targetSchema } from '../../shared/schemas.ts';
import { parse } from '../http.ts';
import type { ProfitMonth } from '../../shared/types.ts';

export const profit = new Hono<AppEnv>();

profit.get('/', async (c) => {
  assertCan(c, 'finance.viewSummary', 'Profit figures aren’t shared with members in this workspace.');
  const month = c.req.query('month') ? parse(monthSchema, c.req.query('month')) : monthKey(todayOf(c));
  const orgId = c.get('org').id;
  const canViewEntries = can(permCtx(c), 'finance.viewEntries');
  const [summary, history, entries] = await Promise.all([svc.monthSummary(orgId, month), svc.history(orgId, month, 6), canViewEntries ? svc.listEntries(orgId, month) : Promise.resolve(null)]);
  const body: ProfitMonth = { summary, history, entries, canViewEntries };
  return c.json(body);
});

profit.post('/entries', async (c) => {
  assertCan(c, 'finance.record', 'Only owners and admins can record profit.');
  const input = await readJson(c, profitEntrySchema);
  const r = await svc.createEntry(actorOf(c), input);
  return c.json(r, r.duplicate ? 200 : 201);
});

profit.patch('/entries/:id', async (c) => {
  assertCan(c, 'finance.edit');
  const input = await readJson(c, profitPatchSchema);
  return c.json(await svc.updateEntry(actorOf(c), c.req.param('id'), input.version, input.changes));
});

profit.delete('/entries/:id', async (c) => {
  assertCan(c, 'finance.edit');
  await svc.deleteEntry(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});

profit.post('/entries/:id/restore', async (c) => {
  assertCan(c, 'finance.edit');
  await svc.restoreEntry(actorOf(c), c.req.param('id'));
  return c.json({ ok: true });
});

profit.put('/target', async (c) => {
  assertCan(c, 'finance.setTarget', 'Only owners and admins can change the monthly target.');
  const input = await readJson(c, targetSchema);
  await svc.setTarget(actorOf(c), input.month, input.targetCents);
  return c.json(await svc.monthSummary(c.get('org').id, input.month));
});
