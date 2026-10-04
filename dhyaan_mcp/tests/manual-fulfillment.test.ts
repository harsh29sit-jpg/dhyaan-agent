import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refillTool } from '../src/tools/refill.js';
import { argumentDigest } from '../src/lib/digest.js';
import { database, now, ownership, token } from './test_offline_support.js';

const args = { ...ownership, request_id: token, token, idempotency_key: 'manual-confirm' };
const request = {
  request_id: token, source_update_id: '1',
  place_id: 'synthetic-place', medicine: 'Synthetic medicine', strength: '10 mg', quantity: 30,
  prescription_ref: 'RX-synthetic', approval_ref: null,
  token_digest: createHash('sha256').update(token).digest('hex'),
  status: 'AWAITING_CONFIRMATION', expires_at: new Date(now + 599000)
};
const readArgs = { ...ownership, request_id: token };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('External fulfillment is forbidden')));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('selected manual fulfillment route', () => {
  it('records a review packet with the confirmation replay evidence, not an external order', async () => {
    const db = database(sql => sql.includes('FROM refill_requests') ?
      { rowCount: 1, rows: [request] } : undefined);
    const result = await refillTool(db.pool, '123', 'refill_request_confirm', args);
    expect(result.data).toMatchObject({
      status: 'PENDING_HANDOFF', fulfillment_verified: false,
      manual_handoff: {
        method: 'MANUAL', status: 'AWAITING_OPERATOR_REVIEW', reference: token,
        operator_assigned: false, dispatch_verified: false, evidence_verified: false, fulfillment_verified: false,
        request: {
          place_id: request.place_id, medicine: request.medicine, strength: request.strength,
          quantity: request.quantity, prescription_ref: request.prescription_ref, approval_ref: null
        },
        required_checks: ['authorized_operator', 'current_prescription_review', 'pharmacy_stock_and_acceptance',
          'price_and_payment_consent', 'collection_or_delivery_arrangement', 'order_reference_and_reconciliation']
      }
    });
    const recorded = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO refill_operations'))!;
    expect(JSON.parse(String(recorded[1]![4]))).toEqual(result.data);
    const packet = (result.data as Record<string, unknown>).manual_handoff;
    for (const secretField of ['token_digest', 'confirmation_token', 'sender_id', 'chat_id']) {
      expect(JSON.stringify(packet)).not.toContain(secretField);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('replays the packet without another transition and returns it for a duplicate confirmation', async () => {
    const pending = { ...request, status: 'PENDING_HANDOFF' };
    const db = database(sql => sql.includes('FROM refill_requests') ?
      { rowCount: 1, rows: [pending] } : undefined);
    const duplicate = await refillTool(db.pool, '123', 'refill_request_confirm', args);
    expect(duplicate.data).toMatchObject({ manual_handoff: { method: 'MANUAL', dispatch_verified: false } });
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE refill_requests'))).toBe(false);
    const replay = database(sql => sql.includes('FROM refill_operations') ? {
      rowCount: 1, rows: [{ args_digest: argumentDigest(args), result_json: duplicate.data }]
    } : undefined);
    expect(await refillTool(replay.pool, '123', 'refill_request_confirm', args))
      .toEqual({ data: duplicate.data, replayed: true });
    expect(replay.query.mock.calls.some(([sql]) => sql.includes('FROM refill_requests'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers a pending manual packet through a sender-bound read without mutating the request', async () => {
    const db = database((sql, values) => {
      if (!sql.includes('FROM refill_requests')) return;
      expect(values).toEqual([token, '123', '456', '456']);
      expect(sql).toContain('prescription_ref,approval_ref');
      return { rowCount: 1, rows: [{ ...request, status: 'PENDING_HANDOFF' }] };
    });
    expect(await refillTool(db.pool, '123', 'refill_request_get', readArgs)).toMatchObject({
      replayed: false, data: { status: 'PENDING_HANDOFF', manual_handoff: {
        method: 'MANUAL', operator_assigned: false, fulfillment_verified: false
      } }
    });
    expect(db.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['AWAITING_CONFIRMATION', 'EXPIRED', 'CANCELLED'])('does not offer a handoff for %s', async status => {
    const db = database(sql => sql.includes('FROM refill_requests') ?
      { rowCount: 1, rows: [{ ...request, status }] } : undefined);
    const result = await refillTool(db.pool, '123', 'refill_request_get', readArgs);
    expect(result.data).not.toHaveProperty('manual_handoff');
    expect(result.data).toHaveProperty('fulfillment_verified', false);
  });

  it('refuses a foreign request before exposing any manual packet', async () => {
    const db = database();
    await expect(refillTool(db.pool, '123', 'refill_request_get', readArgs))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
