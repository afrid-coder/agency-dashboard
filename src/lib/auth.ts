// Better Auth browser client: sign-up, sign-in, password reset, sessions.
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({ baseURL: window.location.origin, basePath: '/api/auth' });

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
