// Better Auth browser client: sign-up, sign-in, password reset, sessions.
// Same origin: the session is an httpOnly cookie. Cross-origin (GitHub Pages
// → Supabase): the session is a bearer token kept by lib/api.ts.
import { createAuthClient } from 'better-auth/client';
import { API_BASE, CROSS_ORIGIN_API, sessionToken } from './api.ts';

export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  basePath: '/api/auth',
  fetchOptions: CROSS_ORIGIN_API
    ? {
        // No cookies cross-site: the bearer token is the session.
        credentials: 'omit',
        auth: { type: 'Bearer', token: () => sessionToken.get() ?? undefined },
        onSuccess: (ctx) => {
          const token = ctx.response.headers.get('set-auth-token');
          if (token) sessionToken.set(token);
          if (String(ctx.request.url).includes('/sign-out')) sessionToken.clear();
        },
      }
    : undefined,
});

/** A network failure (server unreachable) as an auth error, so forms can show it. */
export const unreachable = () => ({ data: null, error: { code: 'NETWORK', status: 0, message: 'Couldn’t reach the Lumera server. Check your connection and try again.' } as { code?: string; status: number; message: string } });

/** Absolute address of a page in this app, for links that leave it (emails, copied links). */
export const appHref = (path: string) => new URL(path.replace(/^\//, ''), window.location.origin + import.meta.env.BASE_URL).href;

const FRIENDLY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match an account. Check them and try again.',
  EMAIL_NOT_VERIFIED: 'Confirm your email first. We’ve sent a fresh confirmation link to your inbox.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead, or reset your password.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists. Sign in instead, or reset your password.',
  INVALID_TOKEN: 'This link is invalid or has expired. Request a new one.',
  PASSWORD_TOO_SHORT: 'Use at least 10 characters.',
  PASSWORD_TOO_LONG: 'Use 128 characters or fewer.',
  INVALID_PASSWORD: 'Your current password isn’t right.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'This account doesn’t use a password.',
};

export function authError(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code && FRIENDLY[error.code]) return FRIENDLY[error.code];
  return error.message || 'Something went wrong. Please try again.';
}
