import type pg from 'pg';
import { argumentDigest } from './digest.js';
import { ToolError } from './errors.js';

export interface Operation {
  tool: string; key: string; logicalKey?: string; args: unknown;
}

// PUBLIC_INTERFACE
export async function executeOnce(pool: pg.Pool, operation: Operation, dispatch: () => Promise<unknown>, successClient?: pg.PoolClient) {
  /** Reserve before a single external action; any dispatched failure remains uncertain until reconciliation. */
  const digest = argumentDigest(operation.args);
  const reserved = await pool.query(`INSERT INTO provider_operations
    (tool,operation_key,logical_key,args_digest,status) VALUES ($1,$2,$3,$4,'RESERVED')
    ON CONFLICT DO NOTHING RETURNING operation_key`,
  [operation.tool, operation.key, operation.logicalKey ?? null, digest]);
  if (!reserved.rowCount) {
    const existing = await pool.query(`SELECT operation_key,args_digest,status,result_json FROM provider_operations
      WHERE tool=$1 AND (operation_key=$2 OR ($3::text IS NOT NULL AND logical_key=$3))`,
    [operation.tool, operation.key, operation.logicalKey ?? null]);
    const entry = existing.rows[0];
    if (!entry || entry.operation_key !== operation.key || entry.args_digest !== digest) {
      throw new ToolError('CONFLICT', 'Operation identity already exists with different arguments or key');
    }
    if (entry.status === 'SUCCEEDED') return { data: entry.result_json, replayed: true };
    // Even RESERVED is ambiguous after process death. Only owner reconciliation can unblock it.
    throw new ToolError('OUTCOME_UNKNOWN', 'Prior operation requires reconciliation before any retry');
  }
  await pool.query(`UPDATE provider_operations SET status='DISPATCHED',updated_at=now()
    WHERE tool=$1 AND operation_key=$2`, [operation.tool, operation.key]);
  try {
    const result = await dispatch();
    // Owned workflows commit success with their state; rollback leaves durable DISPATCHED evidence.
    await (successClient ?? pool).query(`UPDATE provider_operations SET status='SUCCEEDED',result_json=$3,updated_at=now()
      WHERE tool=$1 AND operation_key=$2`, [operation.tool, operation.key, JSON.stringify(result)]);
    return { data: result, replayed: false };
  } catch {
    // Persist uncertainty if possible; a failed update still leaves DISPATCHED, which also blocks retries.
    await pool.query(`UPDATE provider_operations SET status='OUTCOME_UNKNOWN',updated_at=now()
      WHERE tool=$1 AND operation_key=$2`, [operation.tool, operation.key]).catch(() => undefined);
    throw new ToolError('OUTCOME_UNKNOWN', 'Dispatched operation outcome requires reconciliation');
  }
}
