import type pg from 'pg';
import { ToolError } from '../lib/errors.js';

export interface InboundMessage {
  message_id: string; from: string; from_name?: string; type: 'text' | 'audio' | 'button_reply' | 'other';
  text?: string; media_id?: string; button_id?: string; timestamp: string;
}
export interface WhatsAppInbox {
  ingest(messages: InboundMessage[]): Promise<void>;
  claim(runId: string, owner: string, leaseId: string, limit: number): Promise<unknown>;
  ack(runId: string, owner: string, leaseId: string, ids: string[]): Promise<unknown>;
}

async function activeLease(client: pg.PoolClient, runId: string, owner: string, leaseId: string) {
  // Lock the run before inbox rows. Renew/release cannot race this transaction.
  const lease = await client.query(`SELECT expires_at FROM agent_run_leases
    WHERE singleton=true AND run_id=$1 AND owner=$2 AND lease_id=$3 AND expires_at>now() FOR UPDATE`,
  [runId, owner, leaseId]);
  if (!lease.rowCount) throw new ToolError('LEASE_EXPIRED', 'Active matching run lease required');
}

// PUBLIC_INTERFACE
export function postgresWhatsAppInbox(pool: pg.Pool): WhatsAppInbox {
  /** Persist only normalized signed messages; coordinate all inbox operations with the active run lease. */
  async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return {
    async ingest(messages) {
      await transaction(async client => {
        for (const message of messages) {
          const inserted = await client.query(`INSERT INTO wa_inbox
            (message_id,from_number,from_name,type,text,media_id,button_id,wa_timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (message_id) DO NOTHING RETURNING message_id`,
          [message.message_id, message.from, message.from_name ?? null, message.type, message.text ?? null,
            message.media_id ?? null, message.button_id ?? null, message.timestamp]);
          // Redelivery must not extend a messaging window or reset an acknowledgement.
          if (inserted.rowCount) await client.query(`INSERT INTO wa_contact_windows(from_number,last_inbound_at)
            VALUES ($1,$2) ON CONFLICT (from_number) DO UPDATE SET
            last_inbound_at=GREATEST(wa_contact_windows.last_inbound_at,EXCLUDED.last_inbound_at)`,
          [message.from, message.timestamp]);
        }
      });
    },
    async claim(runId, owner, leaseId, limit) {
      return transaction(async client => {
        await activeLease(client, runId, owner, leaseId);
        const messages = await client.query(`WITH candidates AS (
          SELECT message_id FROM wa_inbox
          WHERE status='NEW' OR (status='CLAIMED' AND (
            lease_expires_at<=now() OR NOT EXISTS (
              SELECT 1 FROM agent_run_leases r WHERE r.singleton=true AND r.lease_id=wa_inbox.lease_id
              AND r.run_id=wa_inbox.claimed_by_run AND r.owner=wa_inbox.claimed_by_owner AND r.expires_at>now()
            )))
          ORDER BY received_at,message_id FOR UPDATE SKIP LOCKED LIMIT $4
        ) UPDATE wa_inbox i SET status='CLAIMED',claimed_by_run=$1,claimed_by_owner=$2,lease_id=$3,
          lease_expires_at=LEAST(now()+interval '5 minutes',(SELECT expires_at FROM agent_run_leases WHERE singleton=true))
          FROM candidates c WHERE i.message_id=c.message_id
          RETURNING i.message_id,i.from_number AS "from",i.from_name,i.type,i.text,i.media_id,i.button_id,
            i.wa_timestamp AS timestamp,i.lease_expires_at`,
        [runId, owner, leaseId, limit]);
        return { messages: messages.rows };
      });
    },
    async ack(runId, owner, leaseId, ids) {
      return transaction(async client => {
        await activeLease(client, runId, owner, leaseId);
        const found = await client.query(`SELECT message_id,status,claimed_by_run,claimed_by_owner,lease_id,
          lease_expires_at>now() AS lease_active FROM wa_inbox WHERE message_id=ANY($1::text[]) FOR UPDATE`, [ids]);
        const entries = new Map(found.rows.map(entry => [entry.message_id as string, entry]));
        for (const entry of found.rows) {
          if (entry.claimed_by_run !== runId || entry.claimed_by_owner !== owner || entry.lease_id !== leaseId ||
              (entry.status !== 'DONE' && !entry.lease_active)) {
            throw new ToolError('CONFLICT', 'Cannot acknowledge messages owned by another or expired lease');
          }
        }
        const changed = await client.query(`UPDATE wa_inbox SET status='DONE',text=NULL,from_name=NULL
          WHERE message_id=ANY($1::text[]) AND status='CLAIMED' RETURNING message_id`, [ids]);
        return { acked: changed.rowCount ?? 0,
          already_acked: found.rows.filter(entry => entry.status === 'DONE').map(entry => entry.message_id),
          not_found: ids.filter(id => !entries.has(id)) };
      });
    }
  };
}

// PUBLIC_INTERFACE
export function isWindowOpen(lastInbound: Date | null, now = new Date()): boolean {
  /** Free-form WhatsApp is permitted only strictly within 24 hours of a nonfuture inbound timestamp. */
  if (!lastInbound) return false;
  const age = now.getTime() - lastInbound.getTime();
  return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}
