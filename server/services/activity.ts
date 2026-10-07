import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db, schema, type Queryable } from '../db/client.ts';
import type { ActivityItem, Page } from '../../shared/types.ts';

export interface ActivityInput {
  orgId: string;
  actorId: string | null;
  verb: string;
  entityType: 'task' | 'event' | 'project' | 'client' | 'profit' | 'goal' | 'member' | 'invitation' | 'workspace' | 'export' | 'note';
  entityId?: string | null;
  summary: string;
  restricted?: boolean;
}

export async function logActivity(q: Queryable, a: ActivityInput) {
  await q.insert(schema.activity).values({ ...a, entityId: a.entityId ?? null, restricted: a.restricted ?? false });
}

const toItem = (r: typeof schema.activity.$inferSelect): ActivityItem => ({
  id: r.id,
  actorId: r.actorId,
  verb: r.verb,
  entityType: r.entityType,
  entityId: r.entityId,
  summary: r.summary,
  createdAt: r.createdAt.toISOString(),
});

/** Newest first, cursor = "<iso>|<id>". Restricted (finance) entries only for people who may see them. */
export async function listActivity(orgId: string, opts: { includeRestricted: boolean; cursor?: string; limit?: number; entity?: { type: string; id: string } }): Promise<Page<ActivityItem>> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const conds = [eq(schema.activity.orgId, orgId)];
  if (!opts.includeRestricted) conds.push(eq(schema.activity.restricted, false));
  if (opts.entity) conds.push(eq(schema.activity.entityType, opts.entity.type), eq(schema.activity.entityId, opts.entity.id));
  if (opts.cursor) {
    const [iso, id] = opts.cursor.split('|');
    const at = new Date(iso);
    if (!Number.isNaN(at.getTime()) && id) conds.push(or(lt(schema.activity.createdAt, at), and(eq(schema.activity.createdAt, at), lt(schema.activity.id, id)))!);
  }
  const rows = await db
    .select()
    .from(schema.activity)
    .where(and(...conds))
    .orderBy(desc(schema.activity.createdAt), desc(schema.activity.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toItem);
  const last = rows[limit - 1];
  return { items, nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null };
}
