// The Lumera Creative API as a Hono app, shared by both runtimes:
// server/index.ts (Node: API + web app) and the Supabase Edge Function
// (supabase/functions/api: API only, called by the web app on GitHub Pages).
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { API_URL, APP_ORIGIN, APP_URL } from './env.ts';
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

/** The web app is served from another origin (e.g. GitHub Pages) and calls this API across origins. */
export const CROSS_ORIGIN = APP_ORIGIN !== new URL(API_URL).origin;

export const app = new Hono<AppEnv>();

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
    // Profile photos are <img> loads from the web app's origin.
    crossOriginResourcePolicy: CROSS_ORIGIN ? 'cross-origin' : 'same-origin',
    strictTransportSecurity: APP_URL.startsWith('https://') ? 'max-age=31536000; includeSubDomains' : false,
  }),
);

// Only the web app's origin may call the API from a browser. Sessions travel
// as bearer tokens there, so no credentials (cookies) are shared cross-site.
if (CROSS_ORIGIN) {
  app.use(
    '/api/*',
    cors({
      origin: APP_ORIGIN,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Lumera-Client'],
      exposeHeaders: ['set-auth-token', 'Content-Disposition'],
      maxAge: 7200,
    }),
  );
}

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
//
// Better Auth routes by its public address (API_URL + /api/auth/…). Supabase
// removes the /functions/v1 part of that address before the request reaches
// this code, so the request is presented at its public address again.
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.set(CLIENT_IP_HEADER, clientIp(c));
  const url = new URL(c.req.url);
  const publicUrl = `${API_URL}${url.pathname}${url.search}`;
  const body = c.req.method === 'GET' ? undefined : await c.req.raw.arrayBuffer();
  return auth.handler(new Request(publicUrl, { method: c.req.method, headers, body }));
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

app.onError((err, c) => errorResponse(c, err));
