import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { dispatchTool } from '../src/mcp/registry.js';
import { postgresPaymentEvents, verifyRazorpaySignature } from '../src/routes/razorpay-webhook.js';
import { razorpayReads } from '../src/adapters/razorpay.js';

const secret = 'synthetic-test-webhook-secret';
const config = loadConfig({ RAZORPAY_WEBHOOK_SECRET: secret });
const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {
  id: 'pay_synthetic', email: 'private@example.test', notes: { medical: 'must not persist' }
} } } });
const signature = createHmac('sha256', secret).update(body).digest('hex');

describe('offline signed Razorpay events and reconciliation', () => {
  it('verifies raw bytes using webhook secret and refuses tampering', () => {
    expect(verifyRazorpaySignature(Buffer.from(body), signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(Buffer.from(`${body} `), signature, secret)).toBe(false);
    expect(verifyRazorpaySignature(Buffer.from(body), signature, 'api-key-secret')).toBe(false);
  });
  it('persists minimal signed metadata before acknowledging, never raw payer content', async () => {
    const record = vi.fn();
    const app = createApp(config, { paymentEvents: { record } });
    const post = (sig: string) => request(app).post('/webhooks/razorpay').set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig).send(body);
    expect((await post('bad')).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
    expect((await post(signature)).status).toBe(200);
    expect(record.mock.calls[0]![0]).toMatchObject({ type: 'payment.captured', paymentId: 'pay_synthetic' });
    expect(record.mock.calls[0]![0].id).toMatch(/^digest:/);
    expect(JSON.stringify(record.mock.calls)).not.toContain('private@example');
    expect(JSON.stringify(record.mock.calls)).not.toContain('medical');
    record.mockRejectedValueOnce(new Error('private database diagnostic'));
    expect((await post(signature)).status).toBe(503);
  });
  it('detects event-ID digest conflicts instead of overwriting evidence', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const store = postgresPaymentEvents({ query } as unknown as pg.Pool);
    await expect(store.record({ id: 'event_1', digest: 'digest', type: 'payment.captured' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(query.mock.calls[0]![0]).toContain('provider_webhook_events.body_digest=EXCLUDED.body_digest');
  });
  it('does not infer paid from webhook or missing server mapping', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const reads = razorpayReads(config, { query } as unknown as pg.Pool);
    expect(await reads.reconcile('JRN-1', 'TSK-1', 'plink_1', 'pay_1')).toEqual({
      paid: false, reason: 'SERVER_MAPPING_OR_PAYMENT_MISSING'
    });
  });
  it('preserves raw rail read results and exposes reconciliation through the registry', async () => {
    const wired = loadConfig({ MCP_API_KEY: 'synthetic-offline-test-key-only-0001' });
    const raw = { http_status: 502, body: '<malformed>', parse_error: true };
    const dependencies = {
      audit: { begin: vi.fn(), finish: vi.fn(), healthy: vi.fn() },
      paymentReads: { getLink: vi.fn().mockResolvedValue(raw), getPayment: vi.fn(),
        reconcile: vi.fn().mockResolvedValue({ paid: false, reason: 'NOT_CAPTURED' }) }
    };
    expect(await dispatchTool('razorpay_get_payment_link', { payment_link_id: 'plink_1' }, wired, dependencies)).toEqual(raw);
    expect(await dispatchTool('payment_reconcile', { journey_id: 'JRN-1', task_id: 'TSK-1', payment_link_id: 'plink_1' },
      wired, dependencies)).toMatchObject({ ok: true, data: { paid: false } });
  });
});
