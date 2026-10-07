import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { TRUST_PROXY } from './env.ts';

/** Caller's IP: the first X-Forwarded-For hop behind a trusted proxy, otherwise the socket address. */
export function clientIp(c: Context): string {
  if (TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
