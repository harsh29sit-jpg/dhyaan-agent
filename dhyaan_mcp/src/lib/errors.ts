export type ErrorCode = 'INVALID_ARGUMENT' | 'NOT_CONFIGURED' | 'NOT_IMPLEMENTED' |
  'CONTRACT_UNVERIFIED' | 'UNAUTHORIZED' | 'CONFLICT' | 'RUN_BUSY' |
  'LEASE_EXPIRED' | 'OUTCOME_UNKNOWN' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' |
  'AUDIT_UNAVAILABLE' | 'RATE_LIMITED' | 'LOCATION_UNAVAILABLE' | 'CONFIRMATION_INVALID';

// PUBLIC_INTERFACE
export class ToolError extends Error {
  /** A safe public code/message; never carry provider bodies or credentials here. */
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false) {
    super(message);
  }
}

// PUBLIC_INTERFACE
export function failure(error: unknown, requestId: string) {
  /** Return a redacted tool failure, concealing internal exceptions. */
  const safe = error instanceof ToolError ? error : new ToolError('UPSTREAM_ERROR', 'Operation failed');
  return { ok: false, data: null, error: { code: safe.code, message: safe.message, retryable: safe.retryable },
    request_id: requestId, replayed: false };
}
