import type { ApiErrorBody } from '../../shared/types.ts';

export class ApiRequestError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: unknown;
  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
    this.retryable = Boolean(body.retryable);
    this.retryAfterSeconds = body.retryAfterSeconds;
    this.details = body.details;
  }
}

type Listener = (code: string) => void;
const sessionListeners = new Set<Listener>();
/** Fires when the server says the session ended (401) or the workspace is locked (423). */
export const onSessionProblem = (fn: Listener) => {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
};

export const CLIENT_HEADERS = { 'X-Lumera-Client': '1' } as const;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...CLIENT_HEADERS },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, { code: 'network', message: 'You appear to be offline. Nothing was saved — check your connection and try again.', retryable: true });
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error ?? { code: 'http_error', message: `The server responded with ${res.status}. Please try again.`, retryable: res.status >= 500 };
    if (res.status === 401 || res.status === 423) sessionListeners.forEach((fn) => fn(err.code));
    throw new ApiRequestError(res.status, err);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : err instanceof Error && err.message ? err.message : 'Something unexpected happened. Please try again.');

export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
