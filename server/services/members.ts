import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, type Queryable } from '../db/client.ts';
import { ApiError } from '../http.ts';
import type { Member } from '../../shared/types.ts';
import type { Role } from '../../shared/permissions.ts';

export function avatarUrl(userId: string, avatarUpdatedAt: Date | null, image: string | null) {
  if (avatarUpdatedAt) return `/api/avatars/${userId}?v=${avatarUpdatedAt.getTime()}`;
  return image && image.startsWith('https://') ? image : null;
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      role: schema.memberships.role,
      joinedAt: schema.memberships.createdAt,
      jobTitle: schema.profiles.jobTitle,
      timezone: schema.profiles.timezone,
      avatarAt: schema.avatars.updatedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.user.id))
    .leftJoin(schema.avatars, eq(schema.avatars.userId, schema.user.id))
    .where(eq(schema.memberships.orgId, orgId));
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      avatarUrl: avatarUrl(r.id, r.avatarAt, r.image),
      jobTitle: r.jobTitle,
      role: r.role as Role,
      timezone: r.timezone ?? 'UTC',
      joinedAt: r.joinedAt.toISOString(),
    }))
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

/** Throws unless every id is a member of the workspace. */
export async function assertMembers(q: Queryable, orgId: string, userIds: string[], field = 'assigneeIds') {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return unique;
  const rows = await q
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.userId, unique)));
  if (rows.length !== unique.length)
    throw new ApiError(422, 'invalid', 'One of the selected people isn’t a member of this workspace.', { fields: { [field]: 'Choose people from this workspace.' } });
  return unique;
}

export async function memberNames(orgId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r.name]));
}
