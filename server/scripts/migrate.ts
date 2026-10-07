// Applies pending SQL migrations (server/db/migrations) and exits.
// The server also applies them on start; this is for deploy pipelines.
import { closeDb, dbKind } from '../db/client.ts';

console.log(`Migrations applied (${dbKind === 'postgres' ? 'PostgreSQL' : 'embedded PostgreSQL'}).`);
await closeDb();
process.exit(0);
