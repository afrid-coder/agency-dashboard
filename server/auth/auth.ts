// Authentication with Better Auth: email + password (scrypt), signed in
// straight after sign-up, password reset, database sessions in httpOnly
// cookies, and database-backed rate limits on every auth endpoint.
//
// Signing up alone grants no access to company data. The business owners
// switch on "Admin" and enter the private admin code, which joins the company
// workspace; everyone else accepts an invitation (see services/workspace.ts).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { APP_ORIGIN, APP_URL, AUTH_SECRET, COOKIE_SECURE } from '../env.ts';

/** Set by server/index.ts from the socket (or trusted proxy); never taken from the client. */
export const CLIENT_IP_HEADER = 'x-lumera-client-ip';
import { db, schema } from '../db/client.ts';
import { sendMail, templates } from '../mail/mailer.ts';
import { ApiError } from '../http.ts';
import { checkAdminCode, grantAdminAccess } from '../services/workspace.ts';
import { isValidTimeZone } from '../../shared/dates.ts';
import { passwordProblem } from '../../shared/schemas.ts';
import { log } from '../log.ts';

/** Our own errors, in the shape Better Auth sends back to the sign-up form. */
function asAuthError(err: unknown): never {
  if (err instanceof ApiError) throw new APIError(err.status === 429 ? 'TOO_MANY_REQUESTS' : 'FORBIDDEN', { message: err.message, code: err.code.toUpperCase() });
  throw err;
}

export const auth = betterAuth({
  appName: 'Lumera Creative',
  baseURL: APP_URL,
  basePath: '/api/auth',
  secret: AUTH_SECRET,
  trustedOrigins: [APP_ORIGIN],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(templates.reset(user.email, url));
    },
  },
  // Addresses aren't confirmed at sign-up. Opening an invitation link confirms one.
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: false,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(templates.verify(user.email, user.name, url));
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 120,
    customRules: {
      '/sign-in/email': { window: 60, max: 6 },
      '/sign-up/email': { window: 60 * 10, max: 5 },
      '/request-password-reset': { window: 60 * 10, max: 4 },
      '/reset-password': { window: 60 * 10, max: 8 },
      '/send-verification-email': { window: 60 * 5, max: 3 },
      '/change-password': { window: 60 * 10, max: 6 },
    },
  },
  advanced: {
    useSecureCookies: COOKIE_SECURE,
    cookiePrefix: 'lumera',
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: COOKIE_SECURE },
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  telemetry: { enabled: false },
  logger: {
    level: 'warn',
    log: (level, message) => log[level](`auth.${level}`, { message: String(message).slice(0, 300) }),
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      let candidate: string | undefined;
      let email: string | undefined;
      if (ctx.path === '/sign-up/email') {
        candidate = String(body.password ?? '');
        email = String(body.email ?? '');
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 80) throw new APIError('BAD_REQUEST', { message: 'Enter your name (up to 80 characters).', code: 'INVALID_NAME' });
        // Checked before the account exists, so a wrong code creates nothing.
        if (body.admin === true) {
          try {
            checkAdminCode(body.adminCode, ctx.headers?.get(CLIENT_IP_HEADER) ?? 'unknown');
          } catch (err) {
            asAuthError(err);
          }
        }
      } else if (ctx.path === '/reset-password' || ctx.path === '/change-password') {
        candidate = String(body.newPassword ?? '');
      }
      if (candidate !== undefined) {
        const problem = passwordProblem(candidate, { email });
        if (problem) throw new APIError('BAD_REQUEST', { message: problem, code: 'WEAK_PASSWORD' });
      }
    }),
    // A new account is ready to use at once: the browser's time zone is saved
    // (no separate onboarding step) and, with a valid admin code, the person
    // joins the company workspace.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;
      const created = ctx.context.newSession?.user;
      if (!created) return;
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const timezone = typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : 'UTC';
      await db.update(schema.profiles).set({ timezone, onboardedAt: new Date(), updatedAt: new Date() }).where(eq(schema.profiles.userId, created.id));
      if (body.admin === true) {
        try {
          await grantAdminAccess({ id: created.id, name: created.name }, timezone);
        } catch (err) {
          // The account still exists; the admin code can be entered again after signing in.
          log.error('auth.admin_grant_failed', { userId: created.id, err: String(err).slice(0, 200) });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db.insert(schema.profiles).values({ userId: user.id }).onConflictDoNothing();
          await db.insert(schema.notificationPreferences).values({ userId: user.id }).onConflictDoNothing();
          log.info('auth.user_created', { userId: user.id });
        },
      },
    },
  },
});

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
