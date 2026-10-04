import type pg from 'pg';
import { ToolError } from '../lib/errors.js';

export interface OwnedEvent {
  bot_id: string; update_id: string; sender_id: string; chat_id: string; kind: string;
  text: string | null; token: string | null; callback_id: string | null;
  audio_ref: string | null; location_ref: string | null; event_at: Date;
}

// PUBLIC_INTERFACE
export async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>, uncertainCommit = false): Promise<T> {
  /** Commit one state transition atomically; always release its connection. */
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    try { await client.query('COMMIT'); }
    catch (error) {
      if (uncertainCommit) throw new ToolError('OUTCOME_UNKNOWN', 'Commit outcome requires reconciliation before retry');
      throw error;
    }
    return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// PUBLIC_INTERFACE
export async function activeLease(client: pg.PoolClient, run: string, lease: string): Promise<void> {
  /** Lock the singleton run first, requiring current MCP connector ownership. */
  const found = await client.query(`SELECT expires_at FROM agent_run_leases WHERE singleton=true
    AND run_id=$1 AND owner='mcp-bearer' AND lease_id=$2 AND expires_at>now() FOR UPDATE`, [run, lease]);
  if (!found.rowCount) throw new ToolError('LEASE_EXPIRED', 'Active matching run lease required');
}

// PUBLIC_INTERFACE
export async function ownedEvent(client: pg.PoolClient, bot: string, args: Record<string, unknown>): Promise<OwnedEvent> {
  /** Require an actively claimed event; no caller-provided sender can substitute for this record. */
  await activeLease(client, String(args.run_id), String(args.lease_id));
  const found = await client.query(`SELECT * FROM telegram_inbox WHERE bot_id=$1 AND update_id=$2
    AND status='CLAIMED' AND claimed_by_run=$3 AND claimed_by_owner='mcp-bearer'
    AND lease_id=$4 AND lease_expires_at>now() FOR UPDATE`,
  [bot, args.source_update_id, args.run_id, args.lease_id]);
  if (!found.rowCount) throw new ToolError('UNAUTHORIZED', 'Current claimed Telegram event required');
  return found.rows[0] as OwnedEvent;
}
