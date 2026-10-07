// Workspace settings, members, invitations, activity, notifications, the live
// update stream, and exports.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';
import { readJson } from '../http.ts';
import { assertCan, permCtx, type AppEnv } from '../auth/context.ts';
import { changeRole, invite, listInvitations, removeMember, resendInvite, revokeInvite } from '../services/workspace.ts';
import { listMembers } from '../services/members.ts';
import { listActivity, logActivity } from '../services/activity.ts';
import { listNotifications, markRead } from '../services/notifications.ts';
import { exportWorkspace, profitCsv, tasksCsv } from '../services/export.ts';
import { publish, subscribe } from '../realtime.ts';
import { enforce } from '../ratelimit.ts';
import { can } from '../../shared/permissions.ts';
import { inviteSchema, roleSchema, workspaceSchema } from '../../shared/schemas.ts';

export const workspace = new Hono<AppEnv>();

workspace.patch('/workspace', async (c) => {
  assertCan(c, 'workspace.manage');
  const input = await readJson(c, workspaceSchema);
  const org = c.get('org');
  await db
    .update(schema.organizations)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(schema.organizations.id, org.id));
  await logActivity(db, { orgId: org.id, actorId: c.get('user').id, verb: 'updated', entityType: 'workspace', entityId: org.id, summary: 'updated workspace settings' });
  publish(org.id, { topics: ['workspace', 'profit', 'activity'], actorId: c.get('user').id });
  return c.json({ ok: true });
});

workspace.get('/members', async (c) => c.json(await listMembers(c.get('org').id)));

workspace.patch('/members/:userId', async (c) => {
  assertCan(c, 'members.manage');
  const { role } = await readJson(c, roleSchema);
  await changeRole(c.get('org').id, { id: c.get('user').id, role: c.get('role') }, c.req.param('userId'), role);
  return c.json({ ok: true });
});

workspace.delete('/members/:userId', async (c) => {
  const target = c.req.param('userId');
  if (target !== c.get('user').id) assertCan(c, 'members.manage');
  await removeMember(c.get('org').id, { id: c.get('user').id, role: c.get('role') }, target);
  return c.json({ ok: true });
});

workspace.get('/invitations', async (c) => {
  assertCan(c, 'members.invite');
  return c.json(await listInvitations(c.get('org').id));
});

workspace.post('/invitations', async (c) => {
  assertCan(c, 'members.invite');
  enforce(`invite:${c.get('user').id}`, 30, 3_600_000, 'You’ve sent a lot of invitations. Try again in an hour.');
  const input = await readJson(c, inviteSchema);
  const id = await invite(c.get('org').id, c.get('user').id, input.email, input.role);
  return c.json({ id }, 201);
});

workspace.post('/invitations/:id/resend', async (c) => {
  assertCan(c, 'members.invite');
  enforce(`invite:${c.get('user').id}`, 30, 3_600_000);
  await resendInvite(c.get('org').id, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

workspace.delete('/invitations/:id', async (c) => {
  assertCan(c, 'members.invite');
  await revokeInvite(c.get('org').id, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

workspace.get('/activity', async (c) => {
  const cursor = c.req.query('cursor');
  return c.json(await listActivity(c.get('org').id, { includeRestricted: can(permCtx(c), 'finance.viewEntries'), cursor, limit: Number(c.req.query('limit') ?? 30) }));
});

workspace.get('/notifications', async (c) => c.json(await listNotifications(c.get('org').id, c.get('user').id, c.req.query('cursor'))));

workspace.post('/notifications/read', async (c) => {
  const { ids } = await readJson(c, z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).max(100)]) }));
  await markRead(c.get('org').id, c.get('user').id, ids);
  return c.json({ ok: true });
});

// Live updates: small "what changed" messages; the app refetches.
workspace.get('/stream', (c) => {
  const orgId = c.get('org').id;
  const userId = c.get('user').id;
  return streamSSE(c, async (stream) => {
    let alive = true;
    const unsubscribe = subscribe(orgId, {
      userId,
      send: (m) => {
        void stream.writeSSE({ event: 'change', data: JSON.stringify({ topics: m.topics, actorId: m.actorId, notification: m.notification ?? null }) });
      },
    });
    stream.onAbort(() => {
      alive = false;
      unsubscribe();
    });
    await stream.writeSSE({ event: 'ready', data: '{}' });
    while (alive) {
      await stream.sleep(25_000);
      if (alive) await stream.writeSSE({ event: 'ping', data: '{}' });
    }
  });
});

workspace.get('/export/workspace.json', async (c) => {
  assertCan(c, 'data.export');
  enforce(`export:${c.get('user').id}`, 10, 3_600_000);
  const data = await exportWorkspace(c.get('org').id, c.get('user').id);
  c.header('Content-Disposition', `attachment; filename="${c.get('org').slug}-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(data);
});

workspace.get('/export/:kind{(tasks|profit)\\.csv}', async (c) => {
  assertCan(c, 'data.export');
  enforce(`export:${c.get('user').id}`, 10, 3_600_000);
  const kind = c.req.param('kind');
  const csv = kind === 'tasks.csv' ? await tasksCsv(c.get('org').id, c.get('user').id) : await profitCsv(c.get('org').id, c.get('user').id);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${c.get('org').slug}-${kind}"`);
  return c.body(csv);
});

