import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ToolError } from '../lib/errors.js';

export interface RunStore {
  acquire(runId: string, owner: string, ttlSeconds: number, leaseId?: string): Promise<unknown>;
  release(runId: string, owner: string, leaseId: string): Promise<unknown>;
}

// PUBLIC_INTERFACE
export function postgresRuns(pool: pg.Pool): RunStore {
  /** Enforce one active owner-bound run using an atomic Postgres upsert and exact renewal identity. */
  return {
    async acquire(runId, owner, ttlSeconds, leaseId) {
      if (leaseId) {
        const result = await pool.query(`UPDATE agent_run_leases SET expires_at=now()+($4*interval '1 second')
          WHERE singleton=true AND run_id=$1 AND owner=$2 AND lease_id=$3 AND expires_at>now()
          RETURNING lease_id, expires_at`, [runId, owner, leaseId, ttlSeconds]);
        if (!result.rowCount) throw new ToolError('LEASE_EXPIRED', 'Active matching lease required');
        return result.rows[0];
      }
      const result = await pool.query(`INSERT INTO agent_run_leases(singleton,run_id,owner,lease_id,expires_at)
        VALUES (true,$1,$2,$3,now()+($4*interval '1 second'))
        ON CONFLICT (singleton) DO UPDATE SET run_id=EXCLUDED.run_id, owner=EXCLUDED.owner,
          lease_id=EXCLUDED.lease_id, expires_at=EXCLUDED.expires_at
        WHERE agent_run_leases.expires_at<=now()
        RETURNING lease_id, expires_at`, [runId, owner, randomUUID(), ttlSeconds]);
      if (!result.rowCount) throw new ToolError('RUN_BUSY', 'Another run owns the active lease');
      return result.rows[0];
    },
    async release(runId, owner, leaseId) {
      const result = await pool.query(`DELETE FROM agent_run_leases
        WHERE singleton=true AND run_id=$1 AND owner=$2 AND lease_id=$3 AND expires_at>now()`,
      [runId, owner, leaseId]);
      if (!result.rowCount) throw new ToolError('LEASE_EXPIRED', 'Active matching lease required');
      return { released: true };
    }
  };
}
