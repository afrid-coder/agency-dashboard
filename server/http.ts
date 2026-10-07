import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiErrorBody } from '../shared/types.ts';
import { log } from './log.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Omit<ApiErrorBody['error'], 'code' | 'message'>;
  constructor(status: number, code: string, message: string, extra: Omit<ApiErrorBody['error'], 'code' | 'message'> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what = 'That item') => new ApiError(404, 'not_found', `${what} could not be found. It may have been deleted.`);
export const forbidden = (message = 'You don’t have permission to do that. Ask a workspace owner or admin.') => new ApiError(403, 'forbidden', message);

function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = fieldErrors(parsed.error);
    throw new ApiError(422, 'invalid', Object.values(fields)[0] ?? 'Please check the highlighted fields.', { fields });
  }
  return parsed.data;
}

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'The request body was not valid JSON.');
  }
  return parse(schema, body);
}

export const readQuery = <S extends z.ZodType>(c: Context, schema: S): z.infer<S> => parse(schema, c.req.query());

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, ...err.extra } };
    if (err.extra.retryAfterSeconds) c.header('Retry-After', String(err.extra.retryAfterSeconds));
    return c.json(body, err.status as 400);
  }
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  // Constraint violations that slipped past validation: report them as input problems, not crashes.
  if (code === '23514' || code === '23503' || code === '22P02' || code === '22007') {
    log.warn('db.constraint', { path: c.req.path, code });
    return c.json({ error: { code: 'invalid', message: 'That change doesn’t fit the record’s rules. Check the values and try again.' } } satisfies ApiErrorBody, 422);
  }
  log.error('unhandled', { path: c.req.path, message: (err as Error)?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
  const body: ApiErrorBody = {
    error: { code: 'server_error', message: 'Something went wrong on our side. Your change was not saved — please try again.', retryable: true },
  };
  return c.json(body, 500);
}
