import { ToolError } from './errors.js';

// PUBLIC_INTERFACE
export async function upstreamRequest(url: URL, init: RequestInit, timeoutMs: number, maxBytes = 1024 * 1024) {
  /** Fetch once without redirects; return raw bounded bytes or explicit ambiguous action failure. */
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ToolError('INVALID_ARGUMENT', 'Trusted HTTPS provider endpoint required');
  }
  const action = !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error('Provider body exceeds bound');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    return { status: response.status, bytes: Buffer.concat(chunks) };
  } catch {
    throw new ToolError(action ? 'OUTCOME_UNKNOWN' : controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      action ? 'Provider action may have completed; reconcile before retry' : 'Provider read failed');
  } finally { clearTimeout(timer); }
}
