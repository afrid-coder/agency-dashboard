// Database connection. PostgreSQL through node-postgres when DATABASE_URL is
// set; otherwise an embedded PostgreSQL (PGlite) for local development.
// Both run the same SQL migrations and the same queries. On Supabase (no
// filesystem) the migrations come from migrations.generated.ts.
import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';
import { DATABASE_SSL, DATABASE_URL, IS_EDGE, ROOT } from '../env.ts';
import { log } from '../log.ts';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Queryable = DB | Tx;

const migrationsFolder = path.join(ROOT, 'server/db/migrations');

let close: () => Promise<void>;
let db: DB;
export const dbKind: 'postgres' | 'embedded' = DATABASE_URL ? 'postgres' : 'embedded';

if (DATABASE_URL) {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Edge instances are many and short-lived: keep each one's share small.
    max: Number(process.env.DATABASE_POOL_SIZE ?? (IS_EDGE ? 3 : 10)),
    ssl: DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: DATABASE_SSL !== 'no-verify' },
    idleTimeoutMillis: IS_EDGE ? 10_000 : 30_000,
  });
  pool.on('error', (err) => log.error('db.pool_error', { message: err.message }));
  db = drizzle(pool, { schema });
  if (IS_EDGE) await migrateFromCode(pool);
  else await migrate(db, { migrationsFolder });
  close = () => pool.end();
} else {
  // Loaded by a computed path so the Supabase bundler never pulls PGlite in.
  const embeddedModule = './embedded.ts';
  const { openEmbeddedDb } = (await import(embeddedModule)) as { openEmbeddedDb: (migrationsFolder: string) => Promise<{ db: DB; close: () => Promise<void> }> };
  ({ db, close } = await openEmbeddedDb(migrationsFolder));
}

/**
 * Drizzle's migrator, reading migrations from code instead of disk. Same
 * bookkeeping table and rules (apply every migration newer than the last
 * one recorded), inside one transaction holding an advisory lock so that
 * instances starting together apply each migration once.
 */
async function migrateFromCode(pool: import('pg').Pool) {
  const { MIGRATIONS } = await import('./migrations.generated.ts');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7391001)');
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query('CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    const { rows } = await client.query<{ created_at: string }>('SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1');
    const last = rows[0] ? Number(rows[0].created_at) : null;
    let applied = 0;
    for (const m of MIGRATIONS) {
      if (last !== null && last >= m.folderMillis) continue;
      for (const statement of m.sql) if (statement.trim()) await client.query(statement);
      await client.query('INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)', [m.hash, m.folderMillis]);
      applied++;
    }
    await client.query('COMMIT');
    if (applied) log.info('db.migrated', { applied });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export { db, schema };
export const closeDb = () => close();

/** Postgres unique-violation check that works for both drivers. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  const code = (e as { code?: string })?.code;
  const name = (e as { constraint?: string })?.constraint;
  return code === '23505' && (!constraint || name === constraint);
}
