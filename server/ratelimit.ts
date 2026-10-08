// Fixed-window rate limits for application endpoints (auth endpoints use
// Better Auth's own database-backed limiter). In-memory: per instance.
import type { MiddlewareHandler } from 'hono';
import { ApiError } from './http.ts';
import { clientIp } from './clientIp.ts';

const windows = new Map<string, { start: number; count: number }>();

export function hit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { ok: true, retryAfter: 0 };
  }
  w.count += 1;
  if (w.count > max) return { ok: false, retryAfter: Math.ceil((w.start + windowMs - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

export function enforce(key: string, max: number, windowMs: number, message = 'You’re doing that too quickly. Please wait a moment and try again.') {
  const r = hit(key, max, windowMs);
  if (!r.ok) throw new ApiError(429, 'rate_limited', message, { retryable: true, retryAfterSeconds: r.retryAfter });
}

/** Limits writes per person: generous for normal use, stops runaway scripts. */
export const writeLimit: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const who = (c.get('user' as never) as { id: string } | undefined)?.id ?? clientIp(c);
    enforce(`write:${who}`, 240, 60_000);
  }
  await next();
};

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (now - w.start > 3_600_000) windows.delete(k);
}, 600_000);
// Node: don't keep the process alive for this. (Deno timers are numbers.)
(sweep as unknown as { unref?: () => void }).unref?.();
