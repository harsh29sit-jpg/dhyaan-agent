import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { ToolError } from '../lib/errors.js';

export interface PaymentEvent {
  id: string; digest: string; type: string; paymentId?: string; linkId?: string;
}
export interface PaymentEvents { record(event: PaymentEvent): Promise<void> }

// PUBLIC_INTERFACE
export function postgresPaymentEvents(pool: pg.Pool): PaymentEvents {
  /** Record authenticated event identity without raw payer data; reject reused IDs with changed signed payloads. */
  return {
    async record(event) {
      const saved = await pool.query(`INSERT INTO provider_webhook_events
        (provider,event_id,body_digest,event_type,payment_id,payment_link_id)
        VALUES ('razorpay',$1,$2,$3,$4,$5) ON CONFLICT (provider,event_id) DO UPDATE SET
        body_digest=provider_webhook_events.body_digest
        WHERE provider_webhook_events.body_digest=EXCLUDED.body_digest RETURNING event_id`,
      [event.id, event.digest, event.type, event.paymentId ?? null, event.linkId ?? null]);
      if (!saved.rowCount) throw new ToolError('CONFLICT', 'Webhook event identity conflicts');
    }
  };
}

// PUBLIC_INTERFACE
export function verifyRazorpaySignature(raw: Buffer, signature: string, secret: string): boolean {
  /** Verify SHA-256 raw-body HMAC with the separate webhook secret, never the API key secret. */
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature, 'hex'));
}

const entity = z.object({ entity: z.object({ id: z.string().min(1).max(160) }).passthrough() }).passthrough();
const payloadSchema = z.object({
  event: z.string().min(1).max(100),
  payload: z.object({ payment: entity.optional(), payment_link: entity.optional() }).passthrough()
}).passthrough();

// PUBLIC_INTERFACE
export function razorpayWebhook(secret?: string, events?: PaymentEvents) {
  /** Accept bounded signed test webhook metadata only after persistent deduplication; never update care decisions. */
  const router = express.Router();
  let count = 0, start = Date.now();
  router.post('/', (req, res, next) => {
    if (Date.now() - start >= 60000) { count = 0; start = Date.now(); }
    if (++count > 300) { res.setHeader('Retry-After', '60'); res.status(429).end(); return; }
    next();
  }, express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    if (!secret || !events) { res.status(503).end(); return; }
    if (!Buffer.isBuffer(req.body) || !verifyRazorpaySignature(req.body, req.get('x-razorpay-signature') || '', secret)) {
      res.status(401).end(); return;
    }
    const digest = createHash('sha256').update(req.body).digest('hex');
    let event: PaymentEvent;
    try {
      const parsed = payloadSchema.parse(JSON.parse(req.body.toString('utf8')));
      const eventId = req.get('x-razorpay-event-id');
      if (eventId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(eventId)) throw new Error('Invalid event ID');
      event = { id: eventId || `digest:${digest}`, digest, type: parsed.event,
        paymentId: parsed.payload.payment?.entity.id, linkId: parsed.payload.payment_link?.entity.id };
    } catch { res.status(400).json({ error: 'Invalid webhook payload' }); return; }
    try { await events.record(event); res.json({ received: true }); }
    catch (error) {
      res.status(error instanceof ToolError && error.code === 'CONFLICT' ? 409 : 503)
        .json({ error: 'Durable webhook intake unavailable or conflicting' });
    }
  });
  return router;
}
