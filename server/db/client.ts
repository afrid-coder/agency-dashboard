// Database connection. PostgreSQL through node-postgres when DATABASE_URL is
// set; otherwise an embedded PostgreSQL (PGlite) for local development.
// Both run the same SQL migrations and the same queries.
import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';
import { DATABASE_SSL, DATABASE_URL, EMBEDDED_DB_DIR, ROOT } from '../env.ts';
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
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    ssl: DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: DATABASE_SSL !== 'no-verify' },
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => log.error('db.pool_error', { message: err.message }));
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  close = () => pool.end();
} else {
  // The embedded database is single-process: refuse to open it twice.
  const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  mkdirSync(EMBEDDED_DB_DIR, { recursive: true });
  const lock = path.join(EMBEDDED_DB_DIR, '.lumera-lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {
      alive = false;
    }
    if (alive) {
      console.error(`\nThe embedded development database is in use by another process (pid ${pid}).\nStop the dev server first, then run this command again.\n`);
      process.exit(1);
    }
  }
  writeFileSync(lock, String(process.pid));
  const release = () => {
    try {
      if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(EMBEDDED_DB_DIR);
  const lite = drizzle(client, { schema });
  await migrate(lite, { migrationsFolder });
  db = lite as unknown as DB;
  close = async () => {
    await client.close();
    release();
  };
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
