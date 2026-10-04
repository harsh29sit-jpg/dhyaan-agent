import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { InboundMessage, WhatsAppInbox } from '../tools/whatsapp.js';

const messageSchema = z.object({
  id: z.string().min(1).max(160),
  from: z.string().regex(/^[1-9]\d{7,14}$/),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(40),
  text: z.object({ body: z.string().max(8000) }).optional(),
  audio: z.object({ id: z.string().min(1).max(160) }).optional(),
  interactive: z.object({ button_reply: z.object({ id: z.string().min(1).max(160) }).optional() }).optional(),
  button: z.object({ payload: z.string().min(1).max(160) }).optional()
});
const payloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({ changes: z.array(z.object({
    field: z.literal('messages'),
    value: z.object({
      metadata: z.object({ phone_number_id: z.string().min(1).max(100) }),
      messages: z.array(messageSchema).max(100).optional(),
      contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().max(200) }) })).max(100).optional()
    })
  })).max(100) })).max(100)
});

// PUBLIC_INTERFACE
export function verifyWhatsAppSignature(raw: Buffer, signature: string, secret: string): boolean {
  /** Compare Meta's SHA-256 HMAC over the exact raw bytes; malformed signatures fail closed. */
  if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

// PUBLIC_INTERFACE
export function normalizeWhatsApp(raw: Buffer, phoneNumberId: string, now = Date.now()): InboundMessage[] {
  /** Validate bounded signed payload and configured recipient; external content remains untrusted data. */
  const parsed = payloadSchema.parse(JSON.parse(raw.toString('utf8')));
  const messages: InboundMessage[] = [];
  for (const entry of parsed.entry) for (const change of entry.changes) {
    if (change.value.metadata.phone_number_id !== phoneNumberId) throw new Error('Wrong webhook recipient');
    for (const message of change.value.messages ?? []) {
      if (messages.length >= 100) throw new Error('Message batch too large');
      const time = Number(message.timestamp) * 1000;
      if (time < 0 || time > now || !Number.isFinite(time)) throw new Error('Invalid provider timestamp');
      const name = change.value.contacts?.find(contact => contact.wa_id === message.from)?.profile.name;
      let type: InboundMessage['type'] = 'other';
      let text: string | undefined, mediaId: string | undefined, buttonId: string | undefined;
      if (message.type === 'text') {
        if (!message.text) throw new Error('Missing text payload');
        type = 'text'; text = message.text.body;
      } else if (message.type === 'audio') {
        if (!message.audio) throw new Error('Missing audio payload');
        type = 'audio'; mediaId = message.audio.id;
      } else if (message.type === 'interactive' && message.interactive?.button_reply) {
        type = 'button_reply'; buttonId = message.interactive.button_reply.id;
      } else if (message.type === 'button' && message.button) {
        type = 'button_reply'; buttonId = message.button.payload;
      }
      messages.push({ message_id: message.id, from: `+${message.from}`, from_name: name,
        type, text, media_id: mediaId, button_id: buttonId, timestamp: new Date(time).toISOString() });
    }
  }
  return messages;
}

// PUBLIC_INTERFACE
export function whatsappWebhook(config: Config, inbox?: WhatsAppInbox) {
  /** Register setup verification and signed raw-body intake; acknowledge only after database commit. */
  const router = express.Router();
  let count = 0, windowStart = Date.now();
  router.use((_req, res, next) => {
    if (Date.now() - windowStart >= 60000) { count = 0; windowStart = Date.now(); }
    if (++count > 300) { res.setHeader('Retry-After', '60'); res.status(429).end(); return; }
    next();
  });
  router.get('/', (req, res) => {
    const token = config.whatsappWebhook.verifyToken;
    if (!token) { res.status(503).end(); return; }
    const candidate = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (req.query['hub.mode'] !== 'subscribe' || typeof candidate !== 'string' ||
        typeof challenge !== 'string' || !/^\d{1,100}$/.test(challenge)) { res.status(403).end(); return; }
    const a = Buffer.from(candidate), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(403).end(); return; }
    res.type('text/plain').send(challenge);
  });
  router.post('/', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const { appSecret, phoneNumberId } = config.whatsappWebhook;
    if (!appSecret || !phoneNumberId || !inbox) { res.status(503).end(); return; }
    if (!Buffer.isBuffer(req.body) || !verifyWhatsAppSignature(req.body, req.get('x-hub-signature-256') || '', appSecret)) {
      res.status(401).end(); return;
    }
    let messages: InboundMessage[];
    try { messages = normalizeWhatsApp(req.body, phoneNumberId); }
    catch { res.status(400).json({ error: 'Invalid webhook payload' }); return; }
    try { await inbox.ingest(messages); res.status(200).json({ received: true }); }
    catch { res.status(503).json({ error: 'Durable intake unavailable' }); }
  });
  return router;
}
