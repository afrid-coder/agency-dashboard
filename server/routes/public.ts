// Endpoints that work without a session: health, invitation preview and the
// development-only email outbox.
import { Hono } from 'hono';
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { ApiError } from '../http.ts';
import { devOutboxEnabled } from '../env.ts';
import { lookupInvite } from '../services/workspace.ts';
import { enforce } from '../ratelimit.ts';
import { clientIp } from '../clientIp.ts';

export const publicRoutes = new Hono();

publicRoutes.get('/health', async (c) => {
  await db.execute(sql`select 1`);
  return c.json({ ok: true });
});

publicRoutes.get('/invites/:token', async (c) => {
  enforce(`invite-lookup:${clientIp(c)}`, 30, 60_000);
  return c.json(await lookupInvite(c.req.param('token')));
});

publicRoutes.get('/dev/outbox', async (c) => {
  if (!devOutboxEnabled) throw new ApiError(404, 'not_found', 'Not available.');
  const rows = await db.select().from(schema.devOutbox).orderBy(desc(schema.devOutbox.createdAt)).limit(30);
  return c.json(rows.map((r) => ({ id: r.id, to: r.toAddress, subject: r.subject, text: r.text, link: r.link, createdAt: r.createdAt.toISOString() })));
});

publicRoutes.get('/config', (c) => c.json({ devOutbox: devOutboxEnabled }));
