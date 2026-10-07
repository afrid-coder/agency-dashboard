// Profit toward the monthly goal. Entries record profit (not revenue); totals
// and progress are always calculated here, in application code, from the
// saved entries. Months never reset: history stays in place.
import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { db, isUniqueViolation, schema } from '../db/client.ts';
import { ApiError, notFound } from '../http.ts';
import { logActivity } from './activity.ts';
import { assertProject, type Actor } from './tasks.ts';
import { publish } from '../realtime.ts';
import { addMonths, firstOfMonth, formatISO, lastOfMonth } from '../../shared/dates.ts';
import { formatCents, progressFigures } from '../../shared/money.ts';
import type { ProfitEntry, ProfitSummary } from '../../shared/types.ts';

const PE = schema.profitEntries;
const G = schema.profitGoals;

export async function targetFor(orgId: string, month: string): Promise<{ targetCents: number; custom: boolean }> {
  const [row] = await db
    .select({ targetCents: G.targetCents })
    .from(G)
    .where(and(eq(G.orgId, orgId), lte(G.month, firstOfMonth(month))))
    .orderBy(desc(G.month))
    .limit(1);
  if (row) return { targetCents: row.targetCents, custom: true };
  const [org] = await db.select({ t: schema.organizations.defaultTargetCents }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return { targetCents: org?.t ?? 50_000, custom: false };
}

async function amountsBetween(orgId: string, from: string, to: string) {
  return db
    .select({ amountCents: PE.amountCents, entryDate: PE.entryDate })
    .from(PE)
    .where(and(eq(PE.orgId, orgId), isNull(PE.deletedAt), gte(PE.entryDate, from), lte(PE.entryDate, to)));
}

/** Sum of saved entries for the month, computed in code (integer cents). */
export async function monthSummary(orgId: string, month: string): Promise<ProfitSummary> {
  const [rows, target] = await Promise.all([amountsBetween(orgId, firstOfMonth(month), lastOfMonth(month)), targetFor(orgId, month)]);
  const recorded = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const f = progressFigures(recorded, target.targetCents);
  return {
    month,
    recordedCents: f.recordedCents,
    targetCents: f.targetCents,
    percent: f.percent,
    remainingCents: f.remainingCents,
    overCents: f.overCents,
    achieved: f.achieved,
    entryCount: rows.length,
    targetIsCustom: target.custom,
  };
}

export async function history(orgId: string, endMonth: string, months = 6) {
  const startMonth = addMonths(endMonth, -(months - 1));
  const rows = await amountsBetween(orgId, firstOfMonth(startMonth), lastOfMonth(endMonth));
  const out: { month: string; recordedCents: number; targetCents: number }[] = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(startMonth, i);
    const recordedCents = rows.filter((r) => r.entryDate.startsWith(m)).reduce((s, r) => s + r.amountCents, 0);
    out.push({ month: m, recordedCents, targetCents: (await targetFor(orgId, m)).targetCents });
  }
  return out;
}

export async function listEntries(orgId: string, month: string, opts: { projectId?: string } = {}): Promise<ProfitEntry[]> {
  const conds = [eq(PE.orgId, orgId), isNull(PE.deletedAt)];
  if (opts.projectId) conds.push(eq(PE.projectId, opts.projectId));
  else conds.push(gte(PE.entryDate, firstOfMonth(month)), lte(PE.entryDate, lastOfMonth(month)));
  const rows = await db
    .select({ e: PE, clientName: schema.clients.name, projectName: schema.projects.name })
    .from(PE)
    .leftJoin(schema.clients, eq(schema.clients.id, PE.clientId))
    .leftJoin(schema.projects, eq(schema.projects.id, PE.projectId))
    .where(and(...conds))
    .orderBy(desc(PE.entryDate), desc(PE.createdAt));
  return rows.map(({ e, clientName, projectName }) => ({
    id: e.id,
    amountCents: e.amountCents,
    entryDate: e.entryDate,
    clientId: e.clientId,
    clientName,
    projectId: e.projectId,
    projectName,
    note: e.note,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    version: e.version,
  }));
}

async function assertClientInOrg(orgId: string, clientId: string | null | undefined) {
  if (!clientId) return;
  const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.id, clientId)));
  if (!c) throw new ApiError(422, 'invalid', 'That client isn’t in this workspace.', { fields: { clientId: 'Choose a client from this workspace.' } });
}

export interface EntryInput {
  amountCents: number;
  entryDate: string;
  clientId: string | null;
  projectId: string | null;
  note: string;
  idempotencyKey: string;
  confirmDuplicate?: boolean;
}

const describe = (e: { amountCents: number; entryDate: string }) =>
  `${e.amountCents < 0 ? 'an adjustment of ' : ''}${formatCents(e.amountCents)} profit for ${formatISO(e.entryDate, { month: 'short', day: 'numeric' })}`;

export async function createEntry(actor: Actor, input: EntryInput): Promise<{ entry: ProfitEntry; duplicate: boolean }> {
  const [existing] = await db.select({ id: PE.id, entryDate: PE.entryDate }).from(PE).where(and(eq(PE.orgId, actor.orgId), eq(PE.idempotencyKey, input.idempotencyKey)));
  if (existing) return { entry: (await entryById(actor.orgId, existing.id))!, duplicate: true };
  await assertClientInOrg(actor.orgId, input.clientId);
  await assertProject(db, actor.orgId, input.projectId);

  // Same amount on the same date within the last 15 minutes is probably a double entry.
  if (!input.confirmDuplicate) {
    const recent = await db
      .select({ id: PE.id, createdAt: PE.createdAt })
      .from(PE)
      .where(and(eq(PE.orgId, actor.orgId), isNull(PE.deletedAt), eq(PE.amountCents, input.amountCents), eq(PE.entryDate, input.entryDate)))
      .orderBy(desc(PE.createdAt))
      .limit(1);
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 15 * 60_000)
      throw new ApiError(409, 'possible_duplicate', `An entry of ${formatCents(input.amountCents)} for this date was added a few minutes ago. Add it again anyway?`, {
        details: { existingId: recent[0].id },
      });
  }
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(PE)
        .values({ orgId: actor.orgId, amountCents: input.amountCents, entryDate: input.entryDate, clientId: input.clientId, projectId: input.projectId, note: input.note, idempotencyKey: input.idempotencyKey, createdBy: actor.userId, updatedBy: actor.userId })
        .returning({ id: PE.id });
      await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'recorded', entityType: 'profit', entityId: row.id, summary: `recorded ${describe(input)}`, restricted: true });
      return row.id;
    });
    publish(actor.orgId, { topics: ['profit', 'activity', 'projects'], actorId: actor.userId });
    return { entry: (await entryById(actor.orgId, id))!, duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err, 'profit_idempotency_uq')) {
      const [row] = await db.select({ id: PE.id }).from(PE).where(and(eq(PE.orgId, actor.orgId), eq(PE.idempotencyKey, input.idempotencyKey)));
      return { entry: (await entryById(actor.orgId, row.id))!, duplicate: true };
    }
    throw err;
  }
}

async function entryById(orgId: string, id: string): Promise<ProfitEntry | null> {
  const [row] = await db
    .select({ e: PE, clientName: schema.clients.name, projectName: schema.projects.name })
    .from(PE)
    .leftJoin(schema.clients, eq(schema.clients.id, PE.clientId))
    .leftJoin(schema.projects, eq(schema.projects.id, PE.projectId))
    .where(and(eq(PE.orgId, orgId), eq(PE.id, id)));
  if (!row) return null;
  const { e } = row;
  return {
    id: e.id,
    amountCents: e.amountCents,
    entryDate: e.entryDate,
    clientId: e.clientId,
    clientName: row.clientName,
    projectId: e.projectId,
    projectName: row.projectName,
    note: e.note,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    version: e.version,
  };
}

export async function updateEntry(actor: Actor, id: string, version: number, changes: Partial<Omit<EntryInput, 'idempotencyKey' | 'confirmDuplicate'>>) {
  if (changes.clientId !== undefined) await assertClientInOrg(actor.orgId, changes.clientId);
  if (changes.projectId !== undefined) await assertProject(db, actor.orgId, changes.projectId);
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(PE).where(and(eq(PE.orgId, actor.orgId), eq(PE.id, id), isNull(PE.deletedAt))).for('update');
    if (!current) throw notFound('That profit entry');
    if (current.version !== version) throw new ApiError(409, 'conflict', 'Someone else edited this entry. Reload to see their change before editing again.');
    await tx
      .update(PE)
      .set({ ...changes, version: current.version + 1, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(PE.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'edited', entityType: 'profit', entityId: id, summary: `edited ${describe({ ...current, ...changes })}`, restricted: true });
  });
  publish(actor.orgId, { topics: ['profit', 'activity', 'projects'], actorId: actor.userId });
  return (await entryById(actor.orgId, id))!;
}

export async function deleteEntry(actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(PE).where(and(eq(PE.orgId, actor.orgId), eq(PE.id, id), isNull(PE.deletedAt))).for('update');
    if (!current) throw notFound('That profit entry');
    await tx.update(PE).set({ deletedAt: new Date(), deletedBy: actor.userId }).where(eq(PE.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'deleted', entityType: 'profit', entityId: id, summary: `deleted ${describe(current)}`, restricted: true });
  });
  publish(actor.orgId, { topics: ['profit', 'activity', 'projects'], actorId: actor.userId });
}

export async function restoreEntry(actor: Actor, id: string) {
  const [row] = await db.select().from(PE).where(and(eq(PE.orgId, actor.orgId), eq(PE.id, id), isNotNull(PE.deletedAt)));
  if (!row) throw notFound('That deleted entry');
  await db.transaction(async (tx) => {
    await tx.update(PE).set({ deletedAt: null, deletedBy: null, version: row.version + 1 }).where(eq(PE.id, id));
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'restored', entityType: 'profit', entityId: id, summary: `restored ${describe(row)}`, restricted: true });
  });
  publish(actor.orgId, { topics: ['profit', 'activity', 'projects'], actorId: actor.userId });
}

export async function setTarget(actor: Actor, month: string, targetCents: number) {
  await db.transaction(async (tx) => {
    await tx
      .insert(G)
      .values({ orgId: actor.orgId, month: firstOfMonth(month), targetCents, setBy: actor.userId })
      .onConflictDoUpdate({ target: [G.orgId, G.month], set: { targetCents, setBy: actor.userId, updatedAt: new Date() } });
    await logActivity(tx, { orgId: actor.orgId, actorId: actor.userId, verb: 'set_target', entityType: 'goal', summary: `set the ${formatISO(firstOfMonth(month), { month: 'long', year: 'numeric' })} profit target to ${formatCents(targetCents)}`, restricted: true });
  });
  publish(actor.orgId, { topics: ['profit', 'activity'], actorId: actor.userId });
}

export async function projectProfit(orgId: string, projectId: string) {
  const rows = await db.select({ a: PE.amountCents }).from(PE).where(and(eq(PE.orgId, orgId), eq(PE.projectId, projectId), isNull(PE.deletedAt)));
  return rows.reduce((s, r) => s + r.a, 0);
}

