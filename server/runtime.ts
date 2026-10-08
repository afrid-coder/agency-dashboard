// Supabase Edge Runtime hooks (no-ops under Node).
type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

/** Keep the instance alive until `work` finishes, after the response has been sent. */
export function waitUntil(work: Promise<unknown>) {
  (globalThis as EdgeRuntimeGlobal).EdgeRuntime?.waitUntil?.(work);
}
