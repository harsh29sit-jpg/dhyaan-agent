import type pg from 'pg';

export interface AuditRecord {
  request_id: string;
  run_id: string | null;
  connector_identity: string;
  tool: string;
  args_digest: string;
  real_service: string;
}
export interface AuditSink {
  begin(record: AuditRecord): Promise<void>;
  finish(requestId: string, code: string, latencyMs: number): Promise<void>;
  healthy(): Promise<boolean>;
}

// PUBLIC_INTERFACE
export function postgresAudit(pool: pg.Pool): AuditSink {
  /** Persist dispatch intent and completion; a failed insert must prevent the tool action. */
  return {
    async begin(record) {
      await pool.query(`INSERT INTO tool_call_log
        (request_id, run_id, connector_identity, tool, args_digest, real_service, result_code)
        VALUES ($1,$2,$3,$4,$5,$6,'STARTED')`,
      [record.request_id, record.run_id, record.connector_identity, record.tool, record.args_digest, record.real_service]);
    },
    async finish(requestId, code, latencyMs) {
      await pool.query(`UPDATE tool_call_log SET result_code=$2, latency_ms=$3, completed_at=now()
        WHERE request_id=$1`, [requestId, code, latencyMs]);
    },
    async healthy() {
      try { await pool.query('SELECT request_id FROM tool_call_log LIMIT 0'); return true; }
      catch { return false; }
    }
  };
}
