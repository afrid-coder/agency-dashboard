// Server configuration. Every secret is read from the environment on the
// server only; nothing here is ever sent to the browser.
//
// The same server runs two ways:
// - Node (development, Docker): serves the API and, in production, the web app.
// - Supabase Edge Function (IS_EDGE): the API only; the web app is hosted
//   separately (GitHub Pages) and calls it across origins with bearer tokens.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const IS_EDGE = typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined';

export const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
if (!IS_EDGE) mkdirSync(DATA_DIR, { recursive: true });

export const isProd = process.env.NODE_ENV === 'production' || IS_EDGE;
export const PORT = Number(process.env.PORT ?? 8787);
// The public address of the web app. On Render it defaults to the service's
// own onrender.com URL; set APP_URL for a custom domain or a separately
// hosted web app (e.g. GitHub Pages).
export const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (isProd ? `http://localhost:${PORT}` : 'http://localhost:5173')).replace(/\/$/, '');
export const APP_ORIGIN = new URL(APP_URL).origin;
/** Where this API is reached. On Supabase: https://<ref>.supabase.co/functions/v1 (routes live under /api). */
export const API_URL = (process.env.API_URL || (IS_EDGE && process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/functions/v1` : APP_URL)).replace(/\/$/, '');
export const COOKIE_SECURE = APP_URL.startsWith('https://');
export const TRUST_PROXY = process.env.TRUST_PROXY === '1' || IS_EDGE;

const problems: string[] = [];

// ─── Database ────────────────────────────────────────────────────────────
// Production uses PostgreSQL via DATABASE_URL. Local development without it
// runs an embedded PostgreSQL (PGlite) stored in data/pg.
export const DATABASE_URL = process.env.DATABASE_URL || (IS_EDGE ? (process.env.SUPABASE_DB_URL ?? '') : '');
export const DATABASE_SSL = process.env.DATABASE_SSL ?? (IS_EDGE ? 'no-verify' : DATABASE_URL && !/localhost|127\.0\.0\.1/.test(DATABASE_URL) ? 'require' : 'disable');
export const EMBEDDED_DB_DIR = path.join(DATA_DIR, 'pg');
if (isProd && !DATABASE_URL) problems.push('DATABASE_URL is required in production (a PostgreSQL connection string).');

// ─── Auth secret ─────────────────────────────────────────────────────────
function loadSecret(): string {
  const fromEnv = process.env.BETTER_AUTH_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters.');
    return fromEnv;
  }
  if (isProd) {
    problems.push('BETTER_AUTH_SECRET is required in production. Generate one with: openssl rand -base64 48');
    return '';
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('base64'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}
export const AUTH_SECRET = loadSecret();

// ─── Email ───────────────────────────────────────────────────────────────
export const mail = {
  resendKey: process.env.RESEND_API_KEY ?? '',
  smtpUrl: process.env.SMTP_URL ?? '',
  from: process.env.MAIL_FROM ?? '',
};
export const mailMode: 'resend' | 'smtp' | 'dev' = mail.resendKey ? 'resend' : mail.smtpUrl ? 'smtp' : 'dev';
if (mailMode !== 'dev' && !mail.from) problems.push('MAIL_FROM is required when email delivery is configured.');
/** Printed at startup: without a provider in production, password-reset and invitation emails cannot be delivered. */
export const mailWarning = isProd && mailMode === 'dev' ? 'No email provider configured (RESEND_API_KEY or SMTP_URL). Password-reset and invitation emails cannot be sent.' : null;
/** The development inbox exists only when no provider is configured and we are not in production. */
export const devOutboxEnabled = mailMode === 'dev' && !isProd;

// ─── Lume (Anthropic) ────────────────────────────────────────────────────
const int = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const demoSetting = (process.env.LUME_DEMO_MODE ?? 'auto').toLowerCase();
if (isProd && demoSetting === 'on') problems.push('LUME_DEMO_MODE=on is not allowed in production. Lume never substitutes sample answers in production.');

export const lumeConfig = {
  /** live: Claude via ANTHROPIC_API_KEY. demo: development-only scripted answers over real records. */
  mode: (hasKey && demoSetting !== 'on' ? 'live' : !isProd && demoSetting !== 'off' ? 'demo' : 'unconfigured') as 'live' | 'demo' | 'unconfigured',
  model: process.env.LUME_MODEL ?? 'claude-opus-5',
  effort: (process.env.LUME_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  maxOutputTokens: int('LUME_MAX_OUTPUT_TOKENS', 4096),
  requestTimeoutMs: int('LUME_TIMEOUT_MS', 90_000),
  /** Chat + briefing requests per person per day. */
  dailyRequestsPerUser: int('LUME_DAILY_REQUESTS_PER_USER', 150),
  /** Input + output tokens per workspace per calendar month. */
  monthlyTokenBudget: int('LUME_MONTHLY_TOKEN_BUDGET', 5_000_000),
  /** Requests per person per minute. */
  perMinute: int('LUME_REQUESTS_PER_MINUTE', 8),
};

// ─── Admin sign-up code ──────────────────────────────────────────────────
// Four digits the business owners share privately. Signing up with the
// "Admin" switch and this code joins the company workspace as an admin (the
// very first person creates the workspace and becomes its owner). Everyone
// else needs an invitation. The built-in code is for local development: it
// is published with the source, so a live site must set its own.
const BUILT_IN_ADMIN_CODE = '7391';
export const ADMIN_SIGNUP_CODE = process.env.ADMIN_SIGNUP_CODE ?? BUILT_IN_ADMIN_CODE;
if (!/^\d{4}$/.test(ADMIN_SIGNUP_CODE)) problems.push('ADMIN_SIGNUP_CODE must be exactly four digits.');
else if (isProd && ADMIN_SIGNUP_CODE === BUILT_IN_ADMIN_CODE)
  problems.push('Set ADMIN_SIGNUP_CODE to your own four digits. The built-in code is public in the source and only works in development.');

// ─── Live updates on Supabase ────────────────────────────────────────────
// On Supabase, changes are announced through Realtime broadcast instead of
// the in-process event stream. Messages carry only "what changed" topics.
function realtimeKey(): string {
  const direct = process.env.REALTIME_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (direct) return direct;
  for (const name of ['SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEYS']) {
    try {
      const first = Object.values(JSON.parse(process.env[name] ?? '{}') as Record<string, string>)[0];
      if (first) return first;
    } catch {
      /* not set or not JSON */
    }
  }
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
}
export const realtimeBroadcast = IS_EDGE && process.env.SUPABASE_URL ? { url: process.env.SUPABASE_URL, key: realtimeKey() } : null;

if (problems.length) {
  const message = 'Lumera Creative cannot start:\n' + problems.map((p) => `  • ${p}`).join('\n');
  // An edge function can't exit; failing the import surfaces the reason in its logs.
  if (IS_EDGE) throw new Error(message);
  console.error(`\n${message}\n\nSee .env.example and README.md.\n`);
  process.exit(1);
}
