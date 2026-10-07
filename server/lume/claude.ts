// Anthropic API access for Lume. The client exists only on the server; the
// key is read from ANTHROPIC_API_KEY and never logged or sent to browsers.
import Anthropic from '@anthropic-ai/sdk';
import { lumeConfig } from '../env.ts';
import { ApiError } from '../http.ts';
import { log } from '../log.ts';

export const client = lumeConfig.mode === 'live' ? new Anthropic({ maxRetries: 2, timeout: lumeConfig.requestTimeoutMs }) : null;

export function mapClaudeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ApiError(499, 'lume_cancelled', 'The request was cancelled.');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    log.error('lume.credentials_rejected', { status: err.status });
    return new ApiError(503, 'lume_auth', 'Lume’s Claude credentials were rejected. An owner needs to update the server’s API key.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retry = Number(err.headers?.get?.('retry-after')) || 30;
    return new ApiError(503, 'lume_busy', 'Lume is handling a lot of requests right now. Try again shortly.', { retryable: true, retryAfterSeconds: retry });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ApiError(504, 'lume_timeout', 'Lume took too long to respond. Please try again.', { retryable: true });
  if (err instanceof Anthropic.APIConnectionError) return new ApiError(503, 'lume_unreachable', 'Lume can’t reach Claude right now. Please try again in a moment.', { retryable: true });
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)
    return new ApiError(503, 'lume_unavailable', 'Claude is temporarily unavailable. Please try again in a moment.', { retryable: true });
  if (err instanceof Anthropic.APIError) {
    log.error('lume.api_error', { status: err.status, type: (err.error as { error?: { type?: string } })?.error?.type });
    return new ApiError(502, 'lume_error', 'Lume ran into a problem with that request. Please try again.', { retryable: true });
  }
  log.error('lume.unexpected', { message: (err as Error)?.message });
  return new ApiError(500, 'lume_error', 'Lume ran into an unexpected problem. Please try again.', { retryable: true });
}
