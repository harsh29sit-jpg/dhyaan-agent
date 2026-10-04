import { describe, expect, it } from 'vitest';
import { composeMail, decodePlainText } from '../src/lib/mail-mime.js';
import { allowedPaymentUrl, capturedPaymentEvidence, inrToPaise } from '../src/lib/payment-evidence.js';

describe('offline provider primitives (not live acceptance)', () => {
  it('decodes nested base64url plain text and excludes attachments and HTML', () => {
    const encode = (value: string) => Buffer.from(value).toString('base64url');
    const text = decodePlainText({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: encode('नमस्ते — external data') } },
        { mimeType: 'text/html', body: { data: encode('<script>instructions</script>') } }
      ] },
      { mimeType: 'text/plain', filename: 'attachment.txt', body: { data: encode('private attachment') } }
    ] });
    expect(text).toBe('नमस्ते — external data');
    expect(() => decodePlainText({ mimeType: 'text/plain', body: { data: encode('oversized') } }, 2)).toThrow();
  });
  it('uses a stable RFC Message-ID and rejects injected headers', () => {
    const args = { to: 'synthetic@example.test', subject: 'Medicine ₹1500', bodyText: 'External data',
      operationKey: 'one', messageDomain: 'example.test' };
    const first = composeMail(args), second = composeMail(args);
    expect(first.messageId).toBe(second.messageId);
    expect(Buffer.from(first.raw, 'base64url').toString()).toContain('Content-Transfer-Encoding: base64');
    expect(composeMail({ ...args, operationKey: 'two' }).messageId).not.toBe(first.messageId);
    expect(() => composeMail({ ...args, subject: 'test\r\nBcc: injected@example.test' })).toThrow();
  });
  it('converts INR without fractions or unsafe integers', () => {
    expect(inrToPaise(1500)).toBe(150000);
    expect(inrToPaise(1850)).toBe(185000);
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => inrToPaise(value)).toThrow();
  });
  it('requires full captured funds and exact server mapping', () => {
    const mapping = { journeyId: 'JRN-1', taskId: 'TSK-1', linkId: 'plink_1', referenceId: 'opaque-1',
      amountPaise: 150000, providerOrderId: 'order_1' };
    const link = { id: 'plink_1', reference_id: 'opaque-1', amount: 150000, amount_paid: 150000,
      currency: 'INR', status: 'paid', payments: [{ payment_id: 'pay_1', amount: 150000, status: 'captured' }] };
    const payment = { id: 'pay_1', order_id: 'order_1', amount: 150000, currency: 'INR', status: 'captured', captured: true };
    const check = (l: unknown, p: unknown, journey = 'JRN-1') => capturedPaymentEvidence(mapping, journey, 'TSK-1', l, p);
    expect(check(link, payment).paid).toBe(true);
    expect(check(link, { ...payment, status: 'authorized', captured: false }).paid).toBe(false);
    expect(check({ ...link, amount_paid: 1000 }, payment).paid).toBe(false);
    expect(check(link, { ...payment, order_id: 'order_wrong' }).paid).toBe(false);
    expect(check(link, { ...payment, currency: 'USD' }).paid).toBe(false);
    expect(check({ ...link, payments: [] }, payment).paid).toBe(false);
    expect(check(link, payment, 'JRN-wrong').paid).toBe(false);
    expect(check({ status: 'created' }, payment).paid).toBe(false);
  });
  it('returns only allowlisted hosted payment URLs', () => {
    expect(allowedPaymentUrl('https://rzp.io/i/synthetic')).toBe('https://rzp.io/i/synthetic');
    for (const value of ['https://attacker.test/i/pay', 'https://rzp.io.attacker.test/i/pay', 'http://rzp.io/i/pay',
      'https://user:secret@rzp.io/i/pay']) expect(() => allowedPaymentUrl(value)).toThrow();
  });
});
