import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { TelegramEvent, TelegramInbox } from '../tools/telegram.js';

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.refine(v => v > 0);
const user = z.object({ id: positive, is_bot: z.boolean() }).passthrough();
const message = z.object({
  message_id: positive, date: integer, from: user,
  chat: z.object({ id: positive, type: z.literal('private') }).passthrough(),
  text: z.string().max(4096).optional(),
  voice: z.object({ file_id: z.string().min(1).max(512), duration: z.number().int().min(1).max(60),
    file_size: integer.max(10 * 1024 * 1024).optional(), mime_type: z.literal('audio/ogg').optional() }).passthrough().optional(),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
    live_period: z.number().optional() }).passthrough().optional()
}).passthrough();
const callback = z.object({ id: z.string().min(1).max(160), from: user, message,
  data: z.string().uuid() }).passthrough();

// PUBLIC_INTERFACE
export function normalizeTelegramUpdate(body: unknown, users: string[], now = Date.now()): TelegramEvent | null {
  /** Validate recognized provider shapes and registered private identities; ignore unsupported/group/edited events. */
  const envelope = z.object({ update_id: integer }).passthrough().parse(body);
  const raw = envelope as Record<string, unknown>;
  if (raw.edited_message || raw.edited_channel_post || raw.channel_post || raw.inline_query) return null;
  const candidate = raw.callback_query ? (raw.callback_query as Record<string, unknown>).message : raw.message;
  if (!candidate || typeof candidate !== 'object') return null;
  const c = candidate as Record<string, unknown>;
  if (c.chat && typeof c.chat === 'object' && (c.chat as Record<string, unknown>).type !== 'private') return null;
  const cb = raw.callback_query ? callback.parse(raw.callback_query) : null;
  const m = cb ? cb.message : message.parse(candidate);
  const sender = cb ? cb.from : m.from;
  if (sender.is_bot || !users.includes(String(sender.id)) || m.chat.id !== sender.id) return null;
  // Callback Message.date refers to the old bot message, not the click time.
  const eventTime = cb ? now : m.date * 1000;
  if (eventTime > now + 30000 || now - eventTime > 10 * 60 * 1000) return null;
  const base = { update_id: String(envelope.update_id), sender_id: String(sender.id), chat_id: String(m.chat.id),
    message_id: String(m.message_id), event_at: new Date(eventTime).toISOString() };
  if (cb) return { ...base, kind: 'callback', callback_id: cb.id, token: cb.data };
  if (m.location) {
    if (m.location.live_period !== undefined) return null;
    return { ...base, kind: 'location', latitude: m.location.latitude, longitude: m.location.longitude };
  }
  if (m.voice) return { ...base, kind: 'voice', file_id: m.voice.file_id, duration: m.voice.duration };
  if (m.text) return { ...base, kind: 'text', text: m.text };
  return null;
}

// PUBLIC_INTERFACE
export function telegramWebhook(config: Config, inbox?: TelegramInbox) {
  /** POST intake: authenticate secret header, normalize one update, commit before returning 200. */
  const router = express.Router();
  router.post('/', (req, res, next) => {
    const state = config.services.telegram;
    if (!state.configured || !state.enabled || !inbox || !config.telegram.secret) {
      res.status(503).json({ error: 'Telegram intake unavailable' }); return;
    }
    const received = Buffer.from(req.get('X-Telegram-Bot-Api-Secret-Token') || '');
    const expected = Buffer.from(config.telegram.secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    next();
  }, express.json({ limit: '64kb', strict: true }), async (req, res) => {
    let event: TelegramEvent | null;
    try { event = normalizeTelegramUpdate(req.body, config.telegram.users); }
    catch { res.status(400).json({ error: 'Invalid Telegram update' }); return; }
    try {
      if (event) await inbox!.ingest(event);
      res.status(200).json({ ok: true });
    } catch { res.status(503).json({ error: 'Durable intake unavailable' }); }
  });
  return router;
}
