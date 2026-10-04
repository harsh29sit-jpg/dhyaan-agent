import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refillTool } from '../src/tools/refill.js';
import { argumentDigest } from '../src/lib/digest.js';
import { schemas } from '../src/mcp/schemas.js';
import { database, event, now, ownership, token } from './test_offline_support.js';

const prepare = {
  ...ownership, lookup_ref: token, place_id: 'synthetic-place', medicine: 'Synthetic medicine',
  strength: '10 mg', quantity: 30, idempotency_key: 'prepare'
};
const confirm = { ...ownership, request_id: token, token, idempotency_key: 'confirm' };
const pending = {
  request_id: token, source_update_id: '1',
  token_digest: createHash('sha256').update(token).digest('hex'),
  status: 'AWAITING_CONFIRMATION', expires_at: new Date(now + 599000)
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  // Any accidental purchasing, payment, shipping or other network request fails immediately.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline tests forbid external network')));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent local refill workflow', () => {
  it('requires explicit medicine, strength and bounded integer quantity', () => {
    expect(schemas.refill_request_prepare.safeParse(prepare).success).toBe(true);
    for (const patch of [{ medicine: ' ' }, { strength: '' }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 1001 }]) {
      expect(schemas.refill_request_prepare.safeParse({ ...prepare, ...patch }).success).toBe(false);
    }
  });

  it('keeps missing prescription evidence pending clarification without creating a confirmation token', async () => {
    const db = database(sql => sql.includes('FROM pharmacy_lookups') ?
      { rowCount: 1, rows: [{ place_ids: ['synthetic-place'] }] } : undefined);
    expect(await refillTool(db.pool, '123', 'refill_request_prepare', prepare)).toEqual({
      data: { pending_clarification: true, required: ['current_prescription_evidence'], fulfillment_verified: false },
      replayed: false
    });
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_requests'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_operations'))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['missing', 'expired', 'foreign-owner', 'unselected-place'] as const)(
    'rejects %s lookup selection before creating a request', async reason => {
      const db = database((sql, values) => {
        if (!sql.includes('FROM pharmacy_lookups')) return;
        expect(sql).toContain('source_update_id=$5 AND expires_at>now()');
        expect(values).toEqual([token, '123', '456', '456', '2']);
        return reason === 'unselected-place' ? { rowCount: 1, rows: [{ place_ids: ['different-place'] }] } : { rowCount: 0, rows: [] };
      });
      await expect(refillTool(db.pool, '123', 'refill_request_prepare', { ...prepare, prescription_ref: 'RX-synthetic' }))
        .rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
      expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_requests'))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('prepares an expiring awaiting-confirmation record with a digest, never verified evidence or fulfillment', async () => {
    const db = database(sql => {
      if (sql.includes('FROM pharmacy_lookups')) return { rowCount: 1, rows: [{ place_ids: ['synthetic-place'] }] };
      if (sql.startsWith('INSERT INTO refill_requests')) return { rowCount: 1, rows: [{ request_id: token }] };
    });
    const result = await refillTool(db.pool, '123', 'refill_request_prepare', { ...prepare, prescription_ref: 'RX-synthetic' });
    expect(result).toMatchObject({ replayed: false, data: {
      status: 'AWAITING_CONFIRMATION', expires_in_seconds: 600, evidence_verified: false, fulfillment_verified: false,
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmation_token: expect.stringMatching(/^[0-9a-f-]{36}$/)
    } });
    const insert = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO refill_requests'))!;
    expect(insert[0]).toContain("now()+interval '10 minutes'");
    const data = result.data as Record<string, unknown>;
    expect(insert[1]![11]).toBe(createHash('sha256').update(String(data.confirmation_token)).digest('hex'));
    expect(insert[1]).not.toContain(data.confirmation_token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks another request for the same logical source even with a fresh operation key', async () => {
    const db = database(sql => sql.includes('FROM pharmacy_lookups') ?
      { rowCount: 1, rows: [{ place_ids: ['synthetic-place'] }] } : undefined);
    await expect(refillTool(db.pool, '123', 'refill_request_prepare', {
      ...prepare, prescription_ref: 'RX-synthetic', idempotency_key: 'alternate'
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_operations'))).toBe(false);
  });

  it('replays identical preparation and conflicts on changed medicine or payload', async () => {
    const stored = { request_id: token, status: 'AWAITING_CONFIRMATION', confirmation_token: token, fulfillment_verified: false };
    const db = database(sql => sql.includes('FROM refill_operations') ? {
      rowCount: 1, rows: [{ args_digest: argumentDigest(prepare), result_json: stored }]
    } : undefined);
    expect(await refillTool(db.pool, '123', 'refill_request_prepare', prepare)).toEqual({ data: stored, replayed: true });
    await expect(refillTool(db.pool, '123', 'refill_request_prepare', { ...prepare, quantity: 31 }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_requests'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'foreign-sender', 'bad-token', 'label-only', 'same-source', 'expired', 'cancelled', 'old-event', 'predates-request'] as const)(
    'rejects %s confirmation without transitioning or recording success', async reason => {
      const owned = {
        ...event,
        token: reason === 'label-only' ? null : token,
        event_at: reason === 'old-event' ? new Date(now - 600001) :
          reason === 'predates-request' ? new Date(now - 2000) : event.event_at
      };
      const db = database(sql => {
        if (!sql.includes('FROM refill_requests')) return;
        if (reason === 'unknown' || reason === 'foreign-sender') return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{
          ...pending,
          source_update_id: reason === 'same-source' ? '2' : '1',
          token_digest: reason === 'bad-token' ? 'bad' : pending.token_digest,
          expires_at: reason === 'expired' ? new Date(now) : pending.expires_at,
          status: reason === 'cancelled' ? 'CANCELLED' : pending.status
        }] };
      }, owned);
      await expect(refillTool(db.pool, '123', 'refill_request_confirm', confirm))
        .rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
      expect(db.query.mock.calls.some(([sql]) => sql.includes("SET status='PENDING_HANDOFF'"))).toBe(false);
      expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO refill_operations'))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['callback', 'text'] as const)('accepts exact new bound %s confirmation only as pending manual handoff', async kind => {
    const db = database((sql, values) => {
      if (!sql.includes('FROM refill_requests')) return;
      expect(values).toEqual([token, '123', '456', '456']);
      return { rowCount: 1, rows: [pending] };
    }, { ...event, kind, text: kind === 'text' ? `/confirm ${token}` : null });
    expect(await refillTool(db.pool, '123', 'refill_request_confirm', confirm)).toMatchObject({
      replayed: false, data: {
        request_id: token, status: 'PENDING_HANDOFF', fulfillment_verified: false,
        message: 'Request recorded; manual pharmacy confirmation is still required.'
      }
    });
    expect(db.query.mock.calls.filter(([sql]) => sql.includes("SET status='PENDING_HANDOFF'"))).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /provider_operations|payment|shipment/i.test(sql))).toBe(false);
  });

  it('returns same-key confirmation replay and duplicate callbacks never transition twice', async () => {
    let operation: { args_digest: string; result_json: unknown } | undefined;
    let status = 'AWAITING_CONFIRMATION';
    const db = database((sql, values) => {
      if (sql.includes('FROM refill_operations')) return { rowCount: operation ? 1 : 0, rows: operation ? [operation] : [] };
      if (sql.includes('FROM refill_requests')) return { rowCount: 1, rows: [{ ...pending, status }] };
      if (sql.includes("SET status='PENDING_HANDOFF'")) status = 'PENDING_HANDOFF';
      if (sql.startsWith('INSERT INTO refill_operations')) operation = {
        args_digest: String(values[3]), result_json: JSON.parse(String(values[4]))
      };
    });
    const first = await refillTool(db.pool, '123', 'refill_request_confirm', confirm);
    expect(await refillTool(db.pool, '123', 'refill_request_confirm', confirm)).toEqual({ data: first.data, replayed: true });
    // A new callback operation observes existing local state; it cannot create a second request.
    operation = undefined;
    expect(await refillTool(db.pool, '123', 'refill_request_confirm', { ...confirm, idempotency_key: 'second-click' }))
      .toMatchObject({ data: { status: 'PENDING_HANDOFF', fulfillment_verified: false } });
    expect(db.query.mock.calls.filter(([sql]) => sql.includes("SET status='PENDING_HANDOFF'"))).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rolls back a crash before replay evidence commit, allowing a local-only retry', async () => {
    let fail = true;
    const db = database(sql => {
      if (sql.includes('FROM refill_requests')) return { rowCount: 1, rows: [pending] };
      if (sql.startsWith('INSERT INTO refill_operations') && fail) throw new Error('synthetic crash before commit');
    });
    await expect(refillTool(db.pool, '123', 'refill_request_confirm', confirm)).rejects.toThrow('synthetic crash before commit');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    fail = false;
    expect(await refillTool(db.pool, '123', 'refill_request_confirm', confirm))
      .toMatchObject({ data: { status: 'PENDING_HANDOFF', fulfillment_verified: false } });
    expect(db.release).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    // The double models the rolled-back row; real transactional crash recovery is separately gated.
  });

  it('reads request status only for the claimed sender and exposes expiry without fulfillment', async () => {
    const denied = database();
    await expect(refillTool(denied.pool, '123', 'refill_request_get', { ...ownership, request_id: token }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const db = database((sql, values) => {
      if (!sql.includes('FROM refill_requests')) return;
      expect(sql).toContain("THEN 'EXPIRED'");
      expect(values).toEqual([token, '123', '456', '456']);
      return { rowCount: 1, rows: [{ request_id: token, status: 'EXPIRED' }] };
    });
    expect(await refillTool(db.pool, '123', 'refill_request_get', { ...ownership, request_id: token }))
      .toEqual({ data: { request_id: token, status: 'EXPIRED', fulfillment_verified: false }, replayed: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
