import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` diffs server/db/schema.ts against the migration
// history and writes the next SQL migration. Review it before committing.
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  casing: 'snake_case',
  strict: true,
});
