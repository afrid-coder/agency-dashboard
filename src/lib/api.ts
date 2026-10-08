import type { ApiErrorBody } from '../../shared/types.ts';

/**
 * Where the API lives. Empty (same origin) in development and when the Node
 * server hosts the app; the Supabase function URL when the app is on GitHub
 * Pages (set at build time by .github/workflows/deploy.yml).
 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
export const CROSS_ORIGIN_API = API_BASE !== '';
/** `/api/...` → full URL of the API. */
export const apiUrl = (path: string) => `${API_BASE}${path}`;
/** Server-issued links (e.g. profile photos) are API paths; point them at the API. */
export const apiAsset = (url: string | null) => (url && url.startsWith('/api/') ? apiUrl(url) : url);

/**
 * Session token for a cross-origin API (GitHub Pages → Supabase), sent as a
 * bearer token. Same-origin deployments use the httpOnly session cookie.
 */
const TOKEN_KEY = 'lumera.session';
export const sessionToken = {
  get(): string | null {
    if (!CROSS_ORIGIN_API) return null;
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    if (!CROSS_ORIGIN_API) return;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage blocked: the session lasts until the page closes */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
  },
};
export const authHeaders = (): Record<string, string> => {
  const token = sessionToken.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

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
    res = await fetch(apiUrl(`/api${url}`), {
      method,
      credentials: CROSS_ORIGIN_API ? 'omit' : 'same-origin',
      headers: { 'Content-Type': 'application/json', ...CLIENT_HEADERS, ...authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, { code: 'network', message: 'You appear to be offline. Nothing was saved — check your connection and try again.', retryable: true });
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error ?? { code: 'http_error', message: `The server responded with ${res.status}. Please try again.`, retryable: res.status >= 500 };
    if (res.status === 401) sessionToken.clear();
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

/** Downloads an API file (exports) with the session, then saves it under its server-given name. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(apiUrl(path), { credentials: CROSS_ORIGIN_API ? 'omit' : 'same-origin', headers: authHeaders() });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(res.status, body?.error ?? { code: 'http_error', message: `The download failed (${res.status}). Please try again.` });
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : err instanceof Error && err.message ? err.message : 'Something unexpected happened. Please try again.');

export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
