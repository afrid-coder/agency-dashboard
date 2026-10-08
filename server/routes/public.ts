// Endpoints that work without a session: health, invitation preview, profile
// photos and the development-only email outbox.
import { Buffer } from 'node:buffer';
import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
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

// Photos are addressed by the person's random 32-character id, which only
// their teammates see. Plain <img> loads can't send a session token, so this
// is public — the same way avatar links work on most products.
publicRoutes.get('/avatars/:userId', async (c) => {
  const [row] = await db.select().from(schema.avatars).where(eq(schema.avatars.userId, c.req.param('userId')));
  if (!row) throw new ApiError(404, 'not_found', 'No photo.');
  c.header('Cache-Control', 'public, max-age=86400');
  c.header('Content-Type', row.mime);
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(Buffer.from(row.data, 'base64'));
});

publicRoutes.get('/dev/outbox', async (c) => {
  if (!devOutboxEnabled) throw new ApiError(404, 'not_found', 'Not available.');
  const rows = await db.select().from(schema.devOutbox).orderBy(desc(schema.devOutbox.createdAt)).limit(30);
  return c.json(rows.map((r) => ({ id: r.id, to: r.toAddress, subject: r.subject, text: r.text, link: r.link, createdAt: r.createdAt.toISOString() })));
});

publicRoutes.get('/config', (c) => c.json({ devOutbox: devOutboxEnabled }));
