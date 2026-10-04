import { afterEach, describe, expect, it, vi } from 'vitest';
import { postgresTelegramInbox } from '../src/tools/telegram.js';
import { nearbyPharmacies } from '../src/tools/location.js';
import { normalizeTelegramUpdate } from '../src/routes/telegram-webhook.js';
import { database, event, message, now, ownership, token } from './test_offline_support.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const args = { ...ownership, location_ref: token, radius_m: 3000, limit: 5 };
const location = { latitude: 12, longitude: 77, expires_at: new Date(now + 600000) };

describe('independent location consent mechanics', () => {
  it('does not persist coordinates from an unsolicited pin', async () => {
    const db = database(sql => sql.startsWith('INSERT INTO telegram_inbox') ? { rowCount: 1, rows: [{}] } : undefined);
    const normalized = normalizeTelegramUpdate({ update_id: 2,
      message: { ...message().message, text: undefined, location: { latitude: 12, longitude: 77 } }
    }, ['456'], now)!;
    await postgresTelegramInbox(db.pool, '123').ingest(normalized);
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO telegram_locations'))).toBe(false);
    const intake = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO telegram_inbox'))!;
    expect(intake[1]).not.toContain(12);
    expect(intake[1]).not.toContain(77);
  });

  it('binds location share to current sender/chat request, consumes once and caps expiry from event time', async () => {
    const db = database(sql => {
      if (sql.startsWith('INSERT INTO telegram_inbox')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('SELECT request_id,expires_at')) return { rowCount: 1, rows: [{ request_id: token }] };
    });
    await postgresTelegramInbox(db.pool, '123').ingest({
      update_id: '2', sender_id: '456', chat_id: '456', message_id: '3', kind: 'location',
      event_at: new Date(now).toISOString(), latitude: 12, longitude: 77
    });
    const pending = db.query.mock.calls.find(([sql]) => sql.includes('SELECT request_id,expires_at'))!;
    expect(pending[0]).toContain('NOT consumed AND expires_at>now()');
    expect(pending[0]).toContain('requested_at<=$4 AND $4<=now()');
    expect(pending[1]).toEqual(['123', '456', '456', new Date(now).toISOString()]);
    const stored = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO telegram_locations'))!;
    expect(stored[0]).toContain("LEAST($8::timestamptz+interval '10 minutes',now()+interval '10 minutes')");
    expect(stored[1]!.slice(1, 7)).toEqual(['123', '456', '456', '2', 12, 77]);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('SET consumed=true'))).toBe(true);
  });

  it('revokes outstanding requests and nulls coordinates for the cancelling identity only', async () => {
    const db = database(sql => sql.startsWith('INSERT INTO telegram_inbox') ? { rowCount: 1, rows: [{}] } : undefined);
    await postgresTelegramInbox(db.pool, '123').ingest({
      update_id: '2', sender_id: '456', chat_id: '456', message_id: '3', kind: 'text',
      event_at: new Date(now).toISOString(), text: '/cancel_location'
    });
    const revoke = db.query.mock.calls.find(([sql]) => sql.includes('SET revoked=true'))!;
    expect(revoke[0]).toContain('latitude=NULL,longitude=NULL');
    expect(revoke[1]).toEqual(['123', '456', '456']);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('UPDATE telegram_location_requests SET consumed=true'))).toBe(true);
  });

  it.each(['missing', 'expired', 'revoked', 'foreign-sender', 'foreign-chat', 'foreign-event', 'event-ref-mismatch'] as const)(
    'denies %s consent without search or unauthorized purge', async reason => {
      // The predicate-aware double models returned rows, not database concurrency.
      const db = database((sql, values) => {
        if (!sql.includes('FROM telegram_locations')) return;
        expect(sql).toContain('AND NOT revoked AND expires_at>now()');
        expect(sql).toContain('latitude IS NOT NULL AND longitude IS NOT NULL');
        expect(values).toEqual([token, '123', '456', '456', '2']);
        return reason === 'event-ref-mismatch' ? { rowCount: 1, rows: [location] } : { rowCount: 0, rows: [] };
      }, { ...event, location_ref: reason === 'event-ref-mismatch' ? null : token });
      const nearby = vi.fn();
      await expect(nearbyPharmacies(db.pool, '123', args, { nearby }))
        .rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
      expect(nearby).not.toHaveBeenCalled();
      expect(db.query.mock.calls.some(([sql]) => sql.includes('latitude=NULL'))).toBe(false);
    }
  );

  it('returns candidates only, persists place IDs rather than raw responses, and purges coordinates', async () => {
    const db = database(sql => sql.includes('FROM telegram_locations') ? { rowCount: 1, rows: [location] } : undefined);
    const candidates = [{ place_id: 'synthetic-place', name: 'Synthetic pharmacy', address: 'Private synthetic address',
      maps_link: 'https://maps.google.com/', approximate_straight_line_m: 100, attribution: { google: 'Google Maps' } }];
    const nearby = vi.fn().mockResolvedValue(candidates);
    const result = await nearbyPharmacies(db.pool, '123', args, { nearby });
    expect(result).toMatchObject({ candidates, stock_verified: false, fulfillment_verified: false });
    expect(nearby).toHaveBeenCalledWith(12, 77, 3000, 5);
    const saved = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO pharmacy_lookups'))!;
    expect(saved[1]![5]).toEqual(['synthetic-place']);
    expect(JSON.stringify(saved[1])).not.toContain('Private synthetic address');
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('latitude=NULL'))).toHaveLength(2);
  });

  it('purges authorized coordinates even when provider lookup fails and never saves candidates', async () => {
    const db = database(sql => sql.includes('FROM telegram_locations') ? { rowCount: 1, rows: [location] } : undefined);
    const nearby = vi.fn().mockRejectedValue(new Error('synthetic provider outage'));
    await expect(nearbyPharmacies(db.pool, '123', args, { nearby })).rejects.toThrow('synthetic provider outage');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO pharmacy_lookups'))).toBe(false);
    const purge = db.query.mock.calls.find(([sql]) => sql.includes('latitude=NULL'))!;
    expect(purge[1]).toEqual([token, '123']);
    expect(db.release).toHaveBeenCalledOnce();
  });
});
