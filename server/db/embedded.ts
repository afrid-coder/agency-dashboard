// The embedded PostgreSQL (PGlite) used for local development when
// DATABASE_URL is not set. Single-process: a lock file stops a second
// process from opening the same data folder.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.ts';
import { EMBEDDED_DB_DIR } from '../env.ts';
import type { DB } from './client.ts';

export async function openEmbeddedDb(migrationsFolder: string): Promise<{ db: DB; close: () => Promise<void> }> {
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
  const client = new PGlite(EMBEDDED_DB_DIR);
  const lite = drizzle(client, { schema });
  await migrate(lite, { migrationsFolder });
  return {
    db: lite as unknown as DB,
    close: async () => {
      await client.close();
      release();
    },
  };
}
