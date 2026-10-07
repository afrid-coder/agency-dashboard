// Lumera Creative workspace server.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_SIGNUP_CODE, APP_URL, DATA_DIR, PORT, ROOT, isProd, lumeConfig, mailMode, mailWarning } from './env.ts';
import { closeDb, dbKind } from './db/client.ts';
import { log } from './log.ts';
import { ApiError, errorResponse } from './http.ts';
import { auth, CLIENT_IP_HEADER } from './auth/auth.ts';
import { clientIp } from './clientIp.ts';
import { csrfGuard, requireUser, requireWorkspace, type AppEnv } from './auth/context.ts';
import { writeLimit } from './ratelimit.ts';
import { publicRoutes } from './routes/public.ts';
import { account } from './routes/account.ts';
import { workspace } from './routes/workspace.ts';
import { tasks } from './routes/tasks.ts';
import { calendar } from './routes/calendar.ts';
import { projects, clients } from './routes/projects.ts';
import { profit } from './routes/profit.ts';
import { lume } from './routes/lume.ts';
import { notes } from './routes/notes.ts';
import { startScheduler } from './services/reminders.ts';

const app = new Hono<AppEnv>();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
    },
    referrerPolicy: 'same-origin',
    strictTransportSecurity: APP_URL.startsWith('https://') ? 'max-age=31536000; includeSubDomains' : false,
  }),
);

// Request log without query strings or bodies.
app.use('/api/*', async (c, next) => {
  const start = performance.now();
  await next();
  if (c.req.path !== '/api/stream' && c.req.path !== '/api/health')
    log.info('http', { m: c.req.method, p: c.req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'), s: c.res.status, ms: Math.round(performance.now() - start) });
});

app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
});
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: () => { throw new ApiError(413, 'too_large', 'That request is too large.'); } }));
app.use('/api/*', csrfGuard);

// Authentication (Better Auth): sign-up, sign-in, sessions, password reset.
// The client address is passed to Better Auth's rate limiter in a header we
// set ourselves (any incoming copy is discarded): the socket address, or the
// proxy-supplied X-Forwarded-For when TRUST_PROXY=1.
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.set(CLIENT_IP_HEADER, clientIp(c));
  return auth.handler(new Request(c.req.raw, { headers }));
});

app.route('/api', publicRoutes);

// Signed in, no workspace required.
const signedIn = new Hono<AppEnv>();
signedIn.route('/', account);
app.route('/api', signedIn);

// Workspace members only; every query below is scoped to the active workspace.
const member = new Hono<AppEnv>();
member.use('*', requireUser, requireWorkspace, writeLimit);
member.route('/', workspace);
member.route('/tasks', tasks);
member.route('/events', calendar);
member.route('/projects', projects);
member.route('/clients', clients);
member.route('/profit', profit);
member.route('/lume', lume);
member.route('/notes', notes);
app.route('/api', member);

app.all('/api/*', () => {
  throw new ApiError(404, 'not_found', 'That endpoint does not exist.');
});

if (isProd) {
  const dist = path.join(ROOT, 'dist');
  if (!existsSync(dist)) throw new Error('Run `npm run build` before `npm start`.');
  const indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const root = path.relative(process.cwd(), dist);
  app.use('/assets/*', serveStatic({ root, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
  app.use('*', serveStatic({ root }));
  app.get('*', (c) => c.html(indexHtml));
}

app.onError((err, c) => errorResponse(c, err));

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

