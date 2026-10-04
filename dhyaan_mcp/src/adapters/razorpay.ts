import type pg from 'pg';
import type { Config } from '../config.js';
import { ToolError } from '../lib/errors.js';
import { upstreamRequest } from '../lib/http.js';
import { capturedPaymentEvidence } from '../lib/payment-evidence.js';

export interface PaymentReads {
  getLink(id: string): Promise<unknown>;
  getPayment(id: string): Promise<unknown>;
  reconcile(journeyId: string, taskId: string, linkId: string, paymentId?: string): Promise<unknown>;
}

// PUBLIC_INTERFACE
export function razorpayReads(config: Config, pool: pg.Pool): PaymentReads {
  /** Read test provider status using fixed HTTPS hosts and durable mappings; no action or hidden retry. */
  async function read(kind: 'payment_links' | 'payments', id: string) {
    if (!config.razorpay.keyId?.startsWith('rzp_test_') || !config.razorpay.keySecret) {
      throw new ToolError('NOT_CONFIGURED', 'Razorpay test credentials are missing');
    }
    if (!/^[A-Za-z0-9_]+$/.test(id)) throw new ToolError('INVALID_ARGUMENT', 'Invalid Razorpay identifier');
    const response = await upstreamRequest(new URL(`https://api.razorpay.com/v1/${kind}/${encodeURIComponent(id)}`),
      { headers: { Authorization: `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}` } },
      config.upstreamTimeoutMs);
    let body: unknown;
    let parseError = false;
    try { body = JSON.parse(response.bytes.toString('utf8')); }
    catch { body = response.bytes.toString('utf8'); parseError = true; }
    return { http_status: response.status, body, parse_error: parseError };
  }
  return {
    getLink: id => read('payment_links', id),
    getPayment: id => read('payments', id),
    async reconcile(journeyId, taskId, linkId, paymentId) {
      const found = await pool.query(`SELECT journey_id,task_id,payment_link_id,reference_id,amount_paise,provider_order_id
        FROM razorpay_links WHERE payment_link_id=$1`, [linkId]);
      const mapping = found.rows[0];
      if (!mapping || !mapping.provider_order_id || !paymentId) {
        return { paid: false, reason: 'SERVER_MAPPING_OR_PAYMENT_MISSING' };
      }
      if (mapping.journey_id !== journeyId || mapping.task_id !== taskId) {
        return { paid: false, reason: 'CORRELATION_MISMATCH' };
      }
      const link = await read('payment_links', linkId);
      const payment = await read('payments', paymentId);
      if (link.http_status !== 200 || payment.http_status !== 200 || link.parse_error || payment.parse_error) {
        return { paid: false, reason: 'UNVERIFIABLE_PROVIDER_RESPONSE' };
      }
      return capturedPaymentEvidence({ journeyId: mapping.journey_id, taskId: mapping.task_id,
        linkId: mapping.payment_link_id, referenceId: mapping.reference_id,
        amountPaise: Number(mapping.amount_paise), providerOrderId: mapping.provider_order_id },
      journeyId, taskId, link.body, payment.body);
    }
  };
}
