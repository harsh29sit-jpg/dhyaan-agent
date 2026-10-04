import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ToolError } from '../lib/errors.js';
import { activeLease, transaction } from './ownership.js';

export interface TelegramEvent {
  update_id: string; sender_id: string; chat_id: string; message_id: string;
  kind: 'text' | 'voice' | 'location' | 'callback'; event_at: string;
  text?: string; callback_id?: string; token?: string;
  file_id?: string; duration?: number; latitude?: number; longitude?: number;
}
export interface TelegramInbox {
  ingest(event: TelegramEvent): Promise<void>;
  claim(run: string, lease: string, limit: number): Promise<unknown>;
  ack(run: string, lease: string, ids: string[]): Promise<unknown>;
}

// PUBLIC_INTERFACE
export function postgresTelegramInbox(pool: pg.Pool, bot: string): TelegramInbox {
  /** Normalize durable private intake; never retain raw webhook bodies or raw coordinates in the queue. */
  return {
    async ingest(event) {
      await transaction(pool, async client => {
        // Serialize consent request/share/revocation for this private identity.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tg:${bot}:${event.chat_id}`]);
        const inserted = await client.query(`INSERT INTO telegram_inbox
          (bot_id,update_id,sender_id,chat_id,message_id,kind,event_at,text,callback_id,token)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING update_id`,
        [bot, event.update_id, event.sender_id, event.chat_id, event.message_id, event.kind, event.event_at,
          event.text ?? null, event.callback_id ?? null, event.token ?? null]);
        if (!inserted.rowCount) return;
        await client.query(`UPDATE telegram_locations SET latitude=NULL,longitude=NULL
          WHERE bot_id=$1 AND expires_at<=now()`, [bot]);
        if (event.text === '/cancel_location') {
          await client.query(`UPDATE telegram_location_requests SET consumed=true
            WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3`, [bot, event.sender_id, event.chat_id]);
          await client.query(`UPDATE telegram_locations SET revoked=true,latitude=NULL,longitude=NULL
            WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3`, [bot, event.sender_id, event.chat_id]);
        }
        if (event.kind === 'voice') {
          const ref = randomUUID();
          await client.query(`INSERT INTO private_audio
            (audio_ref,bot_id,sender_id,chat_id,source_update_id,file_id,duration_seconds,media_type,expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'audio/ogg',now()+interval '1 hour')`,
          [ref, bot, event.sender_id, event.chat_id, event.update_id, event.file_id, event.duration]);
          await client.query('UPDATE telegram_inbox SET audio_ref=$3 WHERE bot_id=$1 AND update_id=$2', [bot, event.update_id, ref]);
        }
        if (event.kind === 'location') {
          const pending = await client.query(`SELECT request_id,expires_at FROM telegram_location_requests
            WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3 AND NOT consumed AND expires_at>now()
            AND requested_at<=$4 AND $4<=now() ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`,
          [bot, event.sender_id, event.chat_id, event.event_at]);
          if (!pending.rowCount) return; // Unsolicited pin carries no consent/reference.
          const ref = randomUUID();
          await client.query(`INSERT INTO telegram_locations
            (location_ref,bot_id,sender_id,chat_id,update_id,latitude,longitude,expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,LEAST($8::timestamptz+interval '10 minutes',now()+interval '10 minutes'))`,
          [ref, bot, event.sender_id, event.chat_id, event.update_id, event.latitude, event.longitude, event.event_at]);
          await client.query(`UPDATE telegram_location_requests SET consumed=true
            WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3`, [bot, event.sender_id, event.chat_id]);
          await client.query('UPDATE telegram_inbox SET location_ref=$3 WHERE bot_id=$1 AND update_id=$2', [bot, event.update_id, ref]);
        }
      });
    },
    async claim(run, lease, limit) {
      return transaction(pool, async client => {
        await activeLease(client, run, lease);
        const messages = await client.query(`WITH candidates AS (
          SELECT bot_id,update_id FROM telegram_inbox WHERE bot_id=$1 AND
          (status='NEW' OR (status='CLAIMED' AND (lease_expires_at<=now() OR NOT EXISTS (
            SELECT 1 FROM agent_run_leases r WHERE r.singleton=true AND r.run_id=telegram_inbox.claimed_by_run
            AND r.owner=telegram_inbox.claimed_by_owner AND r.lease_id=telegram_inbox.lease_id AND r.expires_at>now()
          )))) ORDER BY received_at,update_id::bigint FOR UPDATE SKIP LOCKED LIMIT $4
        ) UPDATE telegram_inbox i SET status='CLAIMED',claimed_by_run=$2,claimed_by_owner='mcp-bearer',
          lease_id=$3,lease_expires_at=(SELECT expires_at FROM agent_run_leases WHERE singleton=true)
          FROM candidates c WHERE i.bot_id=c.bot_id AND i.update_id=c.update_id
          RETURNING i.update_id,i.sender_id,i.chat_id,i.message_id,i.kind,i.event_at,i.text,i.token,
            i.audio_ref,i.location_ref,i.lease_expires_at`, [bot, run, lease, limit]);
        return { messages: messages.rows };
      });
    },
    async ack(run, lease, ids) {
      return transaction(pool, async client => {
        await activeLease(client, run, lease);
        const found = await client.query(`SELECT update_id,status,claimed_by_run,lease_id,lease_expires_at>now() AS active
          FROM telegram_inbox WHERE bot_id=$1 AND update_id=ANY($2::text[]) FOR UPDATE`, [bot, ids]);
        if (found.rows.some(e => e.claimed_by_run !== run || e.lease_id !== lease ||
            (e.status !== 'DONE' && !e.active))) throw new ToolError('CONFLICT', 'Acknowledgement ownership mismatch');
        await client.query(`UPDATE telegram_locations SET latitude=NULL,longitude=NULL
          WHERE bot_id=$1 AND update_id=ANY($2::text[])`, [bot, ids]);
        const changed = await client.query(`UPDATE telegram_inbox SET status='DONE',text=NULL,token=NULL
          WHERE bot_id=$1 AND update_id=ANY($2::text[]) AND status='CLAIMED' RETURNING update_id`, [bot, ids]);
        return { acked: changed.rowCount, not_found: ids.filter(id => !found.rows.some(e => e.update_id === id)) };
      });
    }
  };
}
