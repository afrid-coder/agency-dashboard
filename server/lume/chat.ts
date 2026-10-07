// A Lume conversation turn: persist the question, retrieve permitted records
// through tools, stream the answer, and persist it with the records it linked,
// the data sources used and when they were retrieved.
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { lumeConfig } from '../env.ts';
import { ApiError, notFound } from '../http.ts';
import { log } from '../log.ts';
import { client, mapClaudeError } from './claude.ts';
import { SYSTEM_PROMPT, contextBlock } from './prompt.ts';
import { TOOLS, runTool, type LumeCtx } from './tools.ts';
import { listActions } from './actions.ts';
import { recordUsage } from './usage.ts';
import { demoRespond } from './demo.ts';
import { sanitizeTokens, tokensIn } from '../../shared/lumeText.ts';
import type { LumeConversation, LumeConversationSummary, LumeMessage, LumeStreamEvent, RecordRef } from '../../shared/types.ts';

type MessageRow = typeof schema.lumeMessages.$inferSelect;
interface Meta {
  refs?: RecordRef[];
  sources?: string[];
  retrievedAt?: string | null;
  actionIds?: string[];
  error?: LumeMessage['error'];
  confirmation?: boolean;
}

export const toMessage = (r: MessageRow): LumeMessage => {
  const m = (r.meta ?? {}) as Meta;
  return {
    id: r.id,
    role: r.role as 'user' | 'assistant',
    text: r.text,
    demo: r.demo,
    createdAt: r.createdAt.toISOString(),
    refs: m.refs ?? [],
    sources: m.sources ?? [],
    retrievedAt: m.retrievedAt ?? null,
    actionIds: m.actionIds ?? [],
    error: m.error ?? null,
  };
};

// ─── Conversations ───────────────────────────────────────────────────────

export async function listConversations(orgId: string, userId: string): Promise<LumeConversationSummary[]> {
  const rows = await db
    .select()
    .from(schema.lumeConversations)
    .where(and(eq(schema.lumeConversations.orgId, orgId), eq(schema.lumeConversations.userId, userId)))
    .orderBy(desc(schema.lumeConversations.updatedAt))
    .limit(50);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

async function ownedConversation(orgId: string, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.lumeConversations)
    .where(and(eq(schema.lumeConversations.id, id), eq(schema.lumeConversations.orgId, orgId), eq(schema.lumeConversations.userId, userId)));
  if (!row) throw notFound('That conversation');
  return row;
}

export async function getConversation(orgId: string, userId: string, id: string): Promise<LumeConversation> {
  const conv = await ownedConversation(orgId, userId, id);
  const [messages, actions] = await Promise.all([
    db.select().from(schema.lumeMessages).where(eq(schema.lumeMessages.conversationId, id)).orderBy(asc(schema.lumeMessages.createdAt)).limit(400),
    listActions(id),
  ]);
  return { id: conv.id, title: conv.title, messages: messages.map(toMessage), actions };
}

export async function deleteConversation(orgId: string, userId: string, id: string) {
  await ownedConversation(orgId, userId, id);
  await db.delete(schema.lumeConversations).where(eq(schema.lumeConversations.id, id));
}

export async function deleteAllConversations(orgId: string, userId: string) {
  await db.delete(schema.lumeConversations).where(and(eq(schema.lumeConversations.orgId, orgId), eq(schema.lumeConversations.userId, userId)));
  await db.delete(schema.lumeBriefings).where(and(eq(schema.lumeBriefings.orgId, orgId), eq(schema.lumeBriefings.userId, userId)));
}

/** Prior turns as plain text (tool data is re-fetched each turn, never replayed). */
function historyFor(rows: MessageRow[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    const meta = (r.meta ?? {}) as Meta;
    if (meta.error || !r.text.trim()) continue;
    const role = r.role as 'user' | 'assistant';
    const text = meta.confirmation ? `(Saved after the person confirmed) ${r.text}` : r.text;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ─── A turn ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  list_tasks: 'Checking tasks',
  get_task: 'Reading the task',
  list_events: 'Checking the calendar',
  list_projects: 'Looking at projects',
  get_project: 'Reading the project',
  list_clients: 'Looking at clients',
  list_members: 'Checking the team',
  get_profit_summary: 'Checking the profit goal',
  propose_create_task: 'Preparing a task',
  propose_update_task: 'Preparing the change',
  propose_create_event: 'Preparing an event',
  propose_task_list: 'Drafting a task list',
};

export interface TurnInput {
  ctx: LumeCtx;
  message: string;
  conversationId?: string | null;
  retryOf?: string;
  send: (e: LumeStreamEvent) => void;
  signal: AbortSignal;
}

export async function runTurn({ ctx, message, conversationId, retryOf, send, signal }: TurnInput) {
  // Conversation and history.
  let convId = conversationId ?? null;
  if (convId) await ownedConversation(ctx.orgId, ctx.userId, convId);
  else {
    const [c] = await db
      .insert(schema.lumeConversations)
      .values({ orgId: ctx.orgId, userId: ctx.userId, title: message.replace(/\s+/g, ' ').slice(0, 70) })
      .returning({ id: schema.lumeConversations.id });
    convId = c.id;
  }
  ctx.conversationId = convId;

  let prior = await db.select().from(schema.lumeMessages).where(eq(schema.lumeMessages.conversationId, convId)).orderBy(asc(schema.lumeMessages.createdAt)).limit(200);
  let userMessageId: string;
  if (retryOf) {
    const failed = prior.find((m) => m.id === retryOf && m.role === 'assistant');
    const idx = failed ? prior.indexOf(failed) : -1;
    const question = idx > 0 ? prior[idx - 1] : undefined;
    if (!failed || !question || question.role !== 'user') throw new ApiError(422, 'invalid', 'That message can’t be retried. Ask again instead.');
    await db.delete(schema.lumeMessages).where(eq(schema.lumeMessages.id, failed.id));
    prior = prior.filter((m) => m.id !== failed.id && m.id !== question.id);
    userMessageId = question.id;
    message = question.text;
  } else {
    const [u] = await db.insert(schema.lumeMessages).values({ conversationId: convId, role: 'user', text: message }).returning({ id: schema.lumeMessages.id });
    userMessageId = u.id;
  }

  // Records linked earlier in this conversation stay linkable.
  for (const m of prior) for (const r of ((m.meta ?? {}) as Meta).refs ?? []) ctx.refs.set(`${r.type}:${r.id}`, r);

  const messageId = randomUUID();
  const demo = lumeConfig.mode === 'demo';
  send({ type: 'start', conversationId: convId, messageId, userMessageId, demo });

  let text = '';
  let usage = { input: 0, output: 0 };
  let error: LumeMessage['error'] = null;
  const knownActions = new Set<string>();
  const flush = () => {
    send({ type: 'refs', refs: [...ctx.refs.values()] });
    for (const a of ctx.actions)
      if (!knownActions.has(a.id)) {
        knownActions.add(a.id);
        send({ type: 'action', action: a });
      }
  };

  try {
    if (demo) {
      text = await demoRespond(ctx, message, {
        status: (label) => send({ type: 'status', label }),
        delta: (d) => send({ type: 'delta', text: d }),
        flush,
        signal,
      });
    } else if (client) {
      const r = await liveTurn(ctx, historyFor(prior.slice(-16)), message, send, flush, signal);
      text = r.text;
      usage = r.usage;
    } else {
      throw new ApiError(503, 'lume_unconfigured', 'Lume isn’t connected yet. An owner needs to add ANTHROPIC_API_KEY on the server.');
    }
  } catch (err) {
    const e = mapClaudeError(err);
    error = { code: e.code, message: e.message, retryable: Boolean(e.extra.retryable) };
    if (e.code !== 'lume_cancelled') log.warn('lume.turn_failed', { code: e.code });
  }

  // Keep only links to records retrieved for this person.
  const allowed = new Set(ctx.refs.keys());
  const clean = sanitizeTokens(text, allowed).trim();
  const used = new Set(tokensIn(clean));
  const refs = [...ctx.refs.values()].filter((r) => used.has(`${r.type}:${r.id}`));
  const meta: Meta = {
    refs,
    sources: [...ctx.sources],
    retrievedAt: ctx.retrievedAt?.toISOString() ?? null,
    actionIds: ctx.actions.map((a) => a.id),
    error,
  };
  const [row] = await db
    .insert(schema.lumeMessages)
    .values({ id: messageId, conversationId: convId, role: 'assistant', text: clean, meta, demo, model: demo ? null : lumeConfig.model, inputTokens: usage.input, outputTokens: usage.output })
    .returning();
  if (ctx.actions.length)
    await db.update(schema.lumeActions).set({ conversationId: convId }).where(inArray(schema.lumeActions.id, ctx.actions.map((a) => a.id)));
  await db.update(schema.lumeConversations).set({ updatedAt: new Date() }).where(eq(schema.lumeConversations.id, convId));
  if (!demo && (usage.input || usage.output)) await recordUsage(ctx.orgId, ctx.userId, ctx.tz, usage.input, usage.output);
  else if (demo) await recordUsage(ctx.orgId, ctx.userId, ctx.tz, 0, 0);

  const final = toMessage(row);
  if (error) send({ type: 'error', code: error.code, message: error.message, retryable: error.retryable });
  send({ type: 'done', message: final });
}

async function liveTurn(
  ctx: LumeCtx,
  history: Anthropic.MessageParam[],
  message: string,
  send: (e: LumeStreamEvent) => void,
  flush: () => void,
  signal: AbortSignal,
) {
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: message }];
  const tools = TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock(ctx) },
  ];
  let text = '';
  let needsBreak = false;
  const usage = { input: 0, output: 0 };

  for (let turn = 0; turn < 8; turn++) {
    const stream = client!.messages.stream(
      { model: lumeConfig.model, max_tokens: lumeConfig.maxOutputTokens, thinking: { type: 'adaptive' }, output_config: { effort: lumeConfig.effort }, system, tools, messages },
      { signal },
    );
    stream.on('text', (delta) => {
      if (needsBreak && text.trim()) {
        text += '\n\n';
        send({ type: 'delta', text: '\n\n' });
      }
      needsBreak = false;
      text += delta;
      send({ type: 'delta', text: delta });
    });
    const final = await stream.finalMessage();
    const u = final.usage;
    usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.output += u.output_tokens;

    if (final.stop_reason === 'refusal') throw new ApiError(422, 'lume_declined', 'Lume can’t help with that request. Try asking about your work, calendar or goals.');
    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (final.stop_reason === 'max_tokens') {
      if (toolUses.length) throw new ApiError(502, 'lume_truncated', 'Lume’s answer was cut short. Please try again.', { retryable: true });
      text += '\n\n(Answer shortened — ask me to continue.)';
      break;
    }
    if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: final.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      send({ type: 'status', label: STATUS_LABELS[tu.name] ?? 'Working' });
      const r = await runTool(ctx, tu.name, tu.input);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, is_error: r.isError });
    }
    flush();
    messages.push({ role: 'user', content: results });
    needsBreak = true;
    if (turn === 7) text += '\n\nI couldn’t finish gathering everything for that. Try a narrower question.';
  }
  flush();
  return { text, usage };
}
