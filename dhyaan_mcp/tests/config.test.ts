import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { schemas } from '../src/mcp/schemas.js';
import { argumentDigest } from '../src/lib/digest.js';

describe('bootstrap safety', () => {
  it('reports missing services without inventing access', () => {
    const config = loadConfig({});
    expect(config.coreMissing).toContain('DATABASE_URL');
    expect(config.services.gmail.configured).toBe(false);
    expect(JSON.stringify(config.services)).not.toContain('configured":true');
  });
  it('rejects live payments and wrong secret boundaries', () => {
    expect(() => loadConfig({ PAYMENTS_MODE: 'live' })).toThrow();
    expect(() => loadConfig({ RAZORPAY_KEY_ID: 'rzp_live_example', PAYMENTS_MODE: 'test' })).toThrow();
    expect(() => loadConfig({ MCP_API_KEY: 'short' })).toThrow();
    expect(() => loadConfig({ MCP_API_KEY: 'x'.repeat(32), ADMIN_TOKEN: 'x'.repeat(32) })).toThrow();
  });
  it('rejects insecure production origins and database verification bypass', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://localhost:3000' })).toThrow();
    expect(() => loadConfig({ PUBLIC_BASE_URL: 'https://example.test/path' })).toThrow();
    expect(() => loadConfig({ DATABASE_URL: 'postgres://localhost/db?sslmode=require' })).toThrow();
  });
  it('forbids generic state tabs and missing mutation ownership', () => {
    expect(schemas.state_read.safeParse({ tab: 'family_view' }).success).toBe(false);
    expect(schemas.state_update.safeParse({ tab: 'patients', id: 'PAT-1', patch: {}, expected_version: 1 }).success).toBe(false);
  });
  it('rejects unknown fields, unsafe amounts, and mail header injection', () => {
    expect(schemas.tg_send_text.safeParse({ chat_id: '123', text: 'hello', idempotency_key: 'one', token: 'secret' }).success).toBe(false);
    expect(schemas.razorpay_create_payment_link.safeParse({ journey_id: 'JRN-1', task_id: 'TSK-1', order_ref: 'ORD-1',
      amount_inr: 1.5, currency: 'INR', idempotency_key: 'one' }).success).toBe(false);
    expect(schemas.gmail_send_email.safeParse({ to: 'tester@example.test', subject: 'Hi\r\nBcc: victim@example.test',
      body_text: 'hello', idempotency_key: 'one' }).success).toBe(false);
  });
  it('canonicalizes argument digests but preserves changed payload conflicts', () => {
    expect(argumentDigest({ a: 1, b: 2 })).toBe(argumentDigest({ b: 2, a: 1 }));
    expect(argumentDigest({ a: 1 })).not.toBe(argumentDigest({ a: 2 }));
  });
});
