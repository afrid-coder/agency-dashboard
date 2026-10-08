// Lumera Creative workspace server (Node): the API from server/app.ts plus,
// in production, the built web app. The Supabase Edge Function in
// supabase/functions/api runs the same API without the web app.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_SIGNUP_CODE, APP_URL, DATA_DIR, PORT, ROOT, isProd, lumeConfig, mailMode, mailWarning } from './env.ts';
import { closeDb, dbKind } from './db/client.ts';
import { app } from './app.ts';
import { startScheduler } from './services/reminders.ts';

if (isProd) {
  const dist = path.join(ROOT, 'dist');
  if (!existsSync(dist)) throw new Error('Run `npm run build` before `npm start`.');
  const indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const root = path.relative(process.cwd(), dist);
  app.use('/assets/*', serveStatic({ root, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
  app.use('*', serveStatic({ root }));
  app.get('*', (c) => c.html(indexHtml));
}

// The one-time setup code of earlier versions is replaced by the admin code.
rmSync(path.join(DATA_DIR, 'setup-code'), { force: true });
startScheduler();

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  process.stdout.write(
    [
      '',
      `  Lumera Creative  → http://localhost:${PORT}${isProd ? '' : `   (app: ${APP_URL})`}`,
      `  Database         → ${dbKind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'embedded PostgreSQL in data/pg (development)'}`,
      `  Email            → ${mailMode === 'dev' ? 'development outbox at /dev/outbox' : mailMode}`,
      `  Admin sign-up    → ${isProd ? 'code from ADMIN_SIGNUP_CODE' : `code ${ADMIN_SIGNUP_CODE}`}`,
      `  Lume             → ${lumeConfig.mode === 'live' ? `Claude · ${lumeConfig.model} · effort ${lumeConfig.effort}` : lumeConfig.mode === 'demo' ? 'DEMO MODE (no ANTHROPIC_API_KEY) — scripted answers, labelled in the app' : 'not configured — set ANTHROPIC_API_KEY'}`,
      mailWarning ? `  ⚠ ${mailWarning}` : null,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n') + '\n',
  );
});

const shutdown = async () => {
  server.close();
  await closeDb().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
