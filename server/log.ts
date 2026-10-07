// Structured logging that never writes secrets. Keys that look sensitive are
// redacted, and request logs contain paths without query strings.
import { isProd } from './env.ts';

const SENSITIVE = /pass|pin|token|secret|authorization|cookie|api[-_]?key|code|email/i;

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

function write(level: 'debug' | 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
  if (level === 'debug' && isProd) return;
  const payload = data ? (redact(data) as Record<string, unknown>) : undefined;
  if (isProd) {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, event, ...payload }) + '\n');
  } else {
    const color = { debug: 90, info: 36, warn: 33, error: 31 }[level];
    const extra = payload ? ' ' + Object.entries(payload).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ') : '';
    process.stdout.write(`\x1b[${color}m${level.padEnd(5)}\x1b[0m ${event}${extra}\n`);
  }
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => write('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
};
