// Lume endpoints. All require a signed-in workspace member; every read and
// proposed action runs with that person's permissions.
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ApiError, readJson } from '../http.ts';
import { lumeConfig } from '../env.ts';
import { assertCan, permCtx, type AppEnv } from '../auth/context.ts';
import { actorOf, tzOf } from './helpers.ts';
import { memberNames } from '../services/members.ts';
import { getBriefing } from '../lume/briefing.ts';
import { runTurn, listConversations, getConversation, deleteConversation, deleteAllConversations } from '../lume/chat.ts';
import { cancelAction, confirmAction } from '../lume/actions.ts';
import { checkBudget, usageToday } from '../lume/usage.ts';
import { enforce } from '../ratelimit.ts';
import { todayIn, isValidTimeZone } from '../../shared/dates.ts';
import { lumeChatSchema } from '../../shared/schemas.ts';
import type { LumeCtx } from '../lume/tools.ts';
import type { LumeStreamEvent } from '../../shared/types.ts';

export const lume = new Hono<AppEnv>();

async function buildCtx(c: Context<AppEnv>, page = 'other', tzOverride?: string): Promise<LumeCtx> {
  const tz = tzOverride && isValidTimeZone(tzOverride) ? tzOverride : tzOf(c);
  return {
    orgId: c.get('org').id,
    orgName: c.get('org').name,
    userId: c.get('user').id,
    userName: c.get('user').name,
    role: c.get('role'),
    perm: permCtx(c),
    tz,
    today: todayIn(tz),
    actor: actorOf(c),
    conversationId: null,
    page,
    refs: new Map(),
    sources: new Set(),
    retrievedAt: null,
    actions: [],
    memberNames: await memberNames(c.get('org').id),
  };
}

lume.get('/status', async (c) => {
  const usage = await usageToday(c.get('org').id, c.get('user').id, tzOf(c));
  return c.json({ mode: lumeConfig.mode, model: lumeConfig.mode === 'live' ? lumeConfig.model : null, usage });
});

lume.get('/briefing', async (c) => {
  const scope = c.req.query('scope') === 'team' ? 'team' : 'personal';
  if (scope === 'team') assertCan(c, 'lume.teamBriefing', 'The team briefing is available to owners and admins.');
  const refresh = c.req.query('refresh') === '1';
  if (refresh) enforce(`briefing:${c.get('user').id}`, 6, 10 * 60_000, 'You’ve refreshed the briefing several times. Try again in a few minutes.');
  return c.json(await getBriefing(await buildCtx(c, 'dashboard'), scope, refresh));
});

lume.get('/conversations', async (c) => c.json(await listConversations(c.get('org').id, c.get('user').id)));
lume.get('/conversations/:id', async (c) => c.json(await getConversation(c.get('org').id, c.get('user').id, c.req.param('id'))));
lume.delete('/conversations/:id', async (c) => {
  await deleteConversation(c.get('org').id, c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});
lume.delete('/conversations', async (c) => {
  await deleteAllConversations(c.get('org').id, c.get('user').id);
  return c.json({ ok: true });
});

/** Streams one conversation turn as Server-Sent Events. */
lume.post('/chat', async (c) => {
  const input = await readJson(c, lumeChatSchema);
  if (lumeConfig.mode === 'unconfigured') throw new ApiError(503, 'lume_unconfigured', 'Lume isn’t connected yet. An owner needs to add ANTHROPIC_API_KEY on the server.');
  const ctx = await buildCtx(c, input.page, input.timezone);
  await checkBudget(ctx.orgId, ctx.userId, ctx.tz);
  const abort = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => abort.abort());
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => abort.abort());
    // Writes are chained so events arrive in order and all flush before the stream closes.
    let pending = Promise.resolve();
    const send = (e: LumeStreamEvent) => {
      pending = pending.then(() => stream.writeSSE({ data: JSON.stringify(e) })).catch(() => {});
    };
    try {
      await runTurn({ ctx, message: input.message, conversationId: input.conversationId, retryOf: input.retryOf, send, signal: abort.signal });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(500, 'lume_error', 'Lume ran into an unexpected problem. Please try again.', { retryable: true });
      send({ type: 'error', code: e.code, message: e.message, retryable: Boolean(e.extra.retryable) });
    }
    await pending;
  });
});

const confirmSchema = z.object({ payload: z.unknown().optional(), force: z.boolean().optional() });
lume.post('/actions/:id/confirm', async (c) => {
  const input = await readJson(c, confirmSchema);
  return c.json(await confirmAction(actorOf(c), tzOf(c), c.req.param('id'), input.payload, input.force ?? false));
});

lume.post('/actions/:id/cancel', async (c) => c.json(await cancelAction(actorOf(c), c.req.param('id'))));
