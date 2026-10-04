import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '../config.js';
import type { TelegramTransport } from '../adapters/telegram.js';
import type { AudioObjectStore } from '../lib/audio-store.js';
import { resolveAudio } from '../lib/audio-store.js';
import { executeOnce } from '../lib/idempotency.js';
import { ToolError } from '../lib/errors.js';
import { ownedEvent, transaction } from './ownership.js';

// PUBLIC_INTERFACE
export async function telegramAction(pool: pg.Pool, config: Config, tool: string, args: Record<string, unknown>,
  transport: TelegramTransport, audio?: AudioObjectStore) {
  /** Require a current private event; reserve every send before dispatch and never redispatch uncertain operations. */
  return transaction(pool, async client => {
    const event = await ownedEvent(client, config.telegram.botId!, args);
    if (event.chat_id !== args.chat_id || !config.telegram.users.includes(event.sender_id)) {
      throw new ToolError('UNAUTHORIZED', 'Send must target the claimed private sender');
    }
    let body: Record<string, unknown> | FormData = { chat_id: event.chat_id, text: args.text };
    let method: 'sendMessage' | 'sendAudio' = 'sendMessage';
    if (tool === 'tg_send_buttons') {
      const buttons = args.buttons as { token: string; title: string }[];
      for (const button of buttons) {
        const found = await client.query(`SELECT request_id FROM refill_requests WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3
          AND token_digest=$4 AND status='AWAITING_CONFIRMATION' AND expires_at>now()`,
        [event.bot_id, event.sender_id, event.chat_id, createHash('sha256').update(button.token).digest('hex')]);
        if (!found.rowCount) throw new ToolError('CONFIRMATION_INVALID', 'Buttons require a current bound confirmation token');
      }
      body = { chat_id: event.chat_id, text: args.text,
        reply_markup: { inline_keyboard: [buttons.map(b => ({ text: b.title, callback_data: b.token }))] } };
    } else if (tool === 'tg_request_location') {
      body = { chat_id: event.chat_id,
        text: 'Share a one-time location pin to find nearby pharmacy candidates. It is used only for pharmacy lookup, expires within ten minutes, and does not verify stock or place an order. Send /cancel_location to revoke before lookup.',
        reply_markup: { keyboard: [[{ text: 'Share location for pharmacy lookup', request_location: true }]],
          one_time_keyboard: true, resize_keyboard: true } };
    } else if (tool === 'tg_send_audio') {
      if (!audio) throw new ToolError('NOT_CONFIGURED', 'Private audio storage unavailable');
      const ref = await resolveAudio(client, event, String(args.audio_ref));
      if (!ref.object_key) throw new ToolError('INVALID_ARGUMENT', 'Send only synthesized private audio');
      const bytes = await audio.get(ref.object_key);
      if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF') {
        throw new ToolError('INVALID_ARGUMENT', 'Invalid private audio');
      }
      const form = new FormData();
      form.set('chat_id', event.chat_id);
      form.set('audio', new Blob([new Uint8Array(bytes)], { type: ref.media_type }), 'speech.wav');
      body = form;
      // WAV is sent as audio, not falsely advertised as an Opus voice note.
      method = 'sendAudio';
    }
    return executeOnce(pool, { tool, key: String(args.idempotency_key),
      logicalKey: `${event.bot_id}:${event.chat_id}:${event.update_id}:${tool}`, args }, async () => {
      const result = await transport.send(method, body);
      if (tool === 'tg_request_location') {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tg:${event.bot_id}:${event.chat_id}`]);
        await client.query(`UPDATE telegram_location_requests SET consumed=true
          WHERE bot_id=$1 AND sender_id=$2 AND chat_id=$3`, [event.bot_id, event.sender_id, event.chat_id]);
        await client.query(`INSERT INTO telegram_location_requests
          (request_id,bot_id,sender_id,chat_id,purpose,expires_at,operation_key)
          VALUES ($1,$2,$3,$4,'pharmacy_lookup',now()+interval '10 minutes',$5)`,
        [randomUUID(), event.bot_id, event.sender_id, event.chat_id, args.idempotency_key]);
      }
      return result;
    }, client);
  }, true);
}

// PUBLIC_INTERFACE
export async function acknowledgeCallback(pool: pg.Pool, bot: string, args: Record<string, unknown>, transport: TelegramTransport) {
  /** Acknowledge callback transport only; the local confirmation has already committed and is not undone on feedback failure. */
  return transaction(pool, async client => {
    const event = await ownedEvent(client, bot, args);
    if (!event.callback_id) return;
    await executeOnce(pool, { tool: 'tg_callback_ack', key: `${bot}:${event.update_id}`,
      args: { callback_id: event.callback_id } }, async () => {
      await transport.answer(event.callback_id!);
      return { acknowledged: true };
    }, client);
  }, true);
}
