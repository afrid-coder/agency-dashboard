// Usage limits for Lume: per-person rate and daily request caps, and a
// monthly token budget per workspace. Configurable through environment.
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { lumeConfig } from '../env.ts';
import { ApiError } from '../http.ts';
import { enforce } from '../ratelimit.ts';
import { firstOfMonth, lastOfMonth, monthKey, todayIn } from '../../shared/dates.ts';

export async function checkBudget(orgId: string, userId: string, tz: string) {
  enforce(`lume:${userId}`, lumeConfig.perMinute, 60_000, 'You’re sending messages to Lume quickly. Wait a few seconds and try again.');
  const day = todayIn(tz);
  const [today] = await db
    .select({ requests: schema.lumeUsage.requests })
    .from(schema.lumeUsage)
    .where(and(eq(schema.lumeUsage.orgId, orgId), eq(schema.lumeUsage.userId, userId), eq(schema.lumeUsage.day, day)));
  if ((today?.requests ?? 0) >= lumeConfig.dailyRequestsPerUser)
    throw new ApiError(429, 'lume_daily_limit', `You’ve reached today’s limit of ${lumeConfig.dailyRequestsPerUser} Lume requests. It resets tomorrow.`);
  const month = monthKey(day);
  const [m] = await db
    .select({ tokens: sql<number>`coalesce(sum(${schema.lumeUsage.inputTokens} + ${schema.lumeUsage.outputTokens}), 0)`.mapWith(Number) })
    .from(schema.lumeUsage)
    .where(and(eq(schema.lumeUsage.orgId, orgId), gte(schema.lumeUsage.day, firstOfMonth(month)), lte(schema.lumeUsage.day, lastOfMonth(month))));
  if ((m?.tokens ?? 0) >= lumeConfig.monthlyTokenBudget)
    throw new ApiError(429, 'lume_budget', 'The workspace has used this month’s Lume budget. An owner can raise LUME_MONTHLY_TOKEN_BUDGET on the server.');
}

export async function recordUsage(orgId: string, userId: string, tz: string, inputTokens: number, outputTokens: number) {
  const day = todayIn(tz);
  await db
    .insert(schema.lumeUsage)
    .values({ orgId, userId, day, requests: 1, inputTokens, outputTokens })
    .onConflictDoUpdate({
      target: [schema.lumeUsage.orgId, schema.lumeUsage.userId, schema.lumeUsage.day],
      set: {
        requests: sql`${schema.lumeUsage.requests} + 1`,
        inputTokens: sql`${schema.lumeUsage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${schema.lumeUsage.outputTokens} + ${outputTokens}`,
      },
    });
}

export async function usageToday(orgId: string, userId: string, tz: string) {
  const [row] = await db
    .select({ requests: schema.lumeUsage.requests })
    .from(schema.lumeUsage)
    .where(and(eq(schema.lumeUsage.orgId, orgId), eq(schema.lumeUsage.userId, userId), eq(schema.lumeUsage.day, todayIn(tz))));
  return { requests: row?.requests ?? 0, limit: lumeConfig.dailyRequestsPerUser };
}
