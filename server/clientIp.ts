import type { Context } from 'hono';
import { TRUST_PROXY } from './env.ts';

/**
 * Caller's IP: the first X-Forwarded-For hop behind a trusted proxy (always
 * the case on Supabase), otherwise the Node socket address.
 */
export function clientIp(c: Context): string {
  if (TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  // @hono/node-server exposes the incoming request as c.env.incoming.
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}
