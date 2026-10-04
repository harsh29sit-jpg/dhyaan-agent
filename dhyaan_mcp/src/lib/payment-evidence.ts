import { z } from 'zod';
import { ToolError } from './errors.js';

const paise = z.number().int().positive().safe();
const id = z.string().min(1).max(160);
const linkSchema = z.object({
  id, amount: paise, amount_paid: z.number().int().nonnegative().safe(), currency: z.literal('INR'),
  status: z.string(), reference_id: z.string().min(1).max(40),
  payments: z.array(z.object({ payment_id: id, amount: paise, status: z.string() }).passthrough()).max(100).optional()
}).passthrough();
const paymentSchema = z.object({
  id, amount: paise, currency: z.literal('INR'), status: z.string(), captured: z.boolean(), order_id: id
}).passthrough();
export interface PaymentMapping {
  journeyId: string; taskId: string; linkId: string; referenceId: string; amountPaise: number;
  providerOrderId: string;
}

// PUBLIC_INTERFACE
export function inrToPaise(amountInr: number): number {
  /** Convert positive whole INR exactly within JavaScript's safe integer bounds. */
  if (!Number.isSafeInteger(amountInr) || amountInr <= 0 || amountInr > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
    throw new ToolError('INVALID_ARGUMENT', 'Positive safe whole INR amount required');
  }
  return amountInr * 100;
}

// PUBLIC_INTERFACE
export function capturedPaymentEvidence(mapping: PaymentMapping, requestedJourney: string, requestedTask: string,
  linkBody: unknown, paymentBody: unknown) {
  /** Verify server-owned identity, full INR capture, payment membership and provider order association. */
  const link = linkSchema.safeParse(linkBody), payment = paymentSchema.safeParse(paymentBody);
  if (!link.success || !payment.success) return { paid: false, reason: 'UNVERIFIABLE_PROVIDER_DATA' };
  const l = link.data, p = payment.data;
  if (requestedJourney !== mapping.journeyId || requestedTask !== mapping.taskId ||
      l.id !== mapping.linkId || l.reference_id !== mapping.referenceId ||
      l.amount !== mapping.amountPaise || p.amount !== mapping.amountPaise ||
      p.order_id !== mapping.providerOrderId) {
    return { paid: false, reason: 'CORRELATION_MISMATCH' };
  }
  const member = l.payments?.find(entry => entry.payment_id === p.id);
  if (!member || member.amount !== mapping.amountPaise || member.status !== 'captured') {
    return { paid: false, reason: 'PAYMENT_LINKAGE_UNVERIFIED' };
  }
  if (l.status !== 'paid' || l.amount_paid !== mapping.amountPaise ||
      p.status !== 'captured' || !p.captured) {
    return { paid: false, reason: 'FULL_CAPTURE_NOT_VERIFIED' };
  }
  return { paid: true, evidence: { journey_id: mapping.journeyId, task_id: mapping.taskId,
    payment_link_id: l.id, payment_id: p.id, order_id: p.order_id,
    amount_paise: p.amount, currency: p.currency, captured: true } };
}

// PUBLIC_INTERFACE
export function allowedPaymentUrl(value: string): string {
  /** Allow only the documented Razorpay short-link origin for explicit user delivery, never fetching it. */
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'rzp.io' || url.port || url.username || url.password ||
      url.hash || !url.pathname.startsWith('/i/')) {
    throw new ToolError('INVALID_ARGUMENT', 'Unverified hosted payment URL');
  }
  return url.href;
}
