import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { normalizeTelegramUpdate } from '../src/routes/telegram-webhook.js';
import { postgresTelegramInbox } from '../src/tools/telegram.js';
import { telegramAction } from '../src/tools/telegram-actions.js';
import { argumentDigest } from '../src/lib/digest.js';
import { config, database, event, message, now, ownership, providerEnv, token } from './test_offline_support.js';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent Telegram offline intake and actions', () => {
  it('authenticates before parsing and rejects bounded malformed recognized updates', async () => {
    const ingest = vi.fn();
    const app = createApp(config, { telegramInbox: { ingest, claim: vi.fn(), ack: vi.fn() } });
    for (const secret of ['', 'wrong', 'x'.repeat(providerEnv.TELEGRAM_WEBHOOK_SECRET.length)]) {
      expect((await request(app).post('/webhooks/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', secret).send(message())).status).toBe(401);
    }
    const post = (body: unknown) => request(app).post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', providerEnv.TELEGRAM_WEBHOOK_SECRET).send(body as object);
    expect((await post({ ...message(), update_id: Number.MAX_SAFE_INTEGER + 1 })).status).toBe(400);
    expect((await post({ ...message(), message: { ...message().message, text: 'x'.repeat(4097) } })).status).toBe(400);
    expect((await post({ oversized: 'x'.repeat(66000) })).status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
    expect((await request(createApp(config)).post('/webhooks/telegram').send(message())).status).toBe(503);
    expect((await request(createApp(loadConfig({ ...providerEnv, TELEGRAM_ENABLED: 'false' })))
      .post('/webhooks/telegram').send(message())).status).toBe(503);
    expect((await request(app).post('/webhooks/whatsapp').send({})).status).toBe(404);
  });

  it('ignores bots, mismatched private identities, unsolicited update types and stale messages', () => {
    const m = message().message;
    const variants = [
      { ...m, from: { id: 456, is_bot: true } },
      { ...m, from: { id: 789, is_bot: false } },
      { ...m, chat: { id: 789, type: 'private' } },
      { ...m, chat: { id: -1, type: 'group' } },
      { ...m, date: Math.floor(now / 1000) - 601 },
      { ...m, date: Math.floor(now / 1000) + 31 },
      { ...m, location: { latitude: 12, longitude: 77, live_period: 0 } }
    ];
    for (const variant of variants) expect(normalizeTelegramUpdate({ update_id: 2, message: variant }, ['456'], now)).toBeNull();
    expect(normalizeTelegramUpdate({ update_id: 2, edited_message: m }, ['456'], now)).toBeNull();
    expect(normalizeTelegramUpdate({ update_id: 2 }, ['456'], now)).toBeNull();
  });

  it('binds callback sender and UUID data, not the bot author or old message timestamp', () => {
    const callback = {
      id: 'synthetic-click', from: { id: 456, is_bot: false }, data: token,
      message: { ...message().message, from: { id: 123, is_bot: true }, date: 1 }
    };
    expect(normalizeTelegramUpdate({ update_id: 2, callback_query: callback }, ['456'], now))
      .toMatchObject({ kind: 'callback', sender_id: '456', token, event_at: new Date(now).toISOString() });
    expect(normalizeTelegramUpdate({ update_id: 2, callback_query: { ...callback, from: { id: 789, is_bot: false } } }, ['456'], now)).toBeNull();
    expect(() => normalizeTelegramUpdate({ update_id: 2, callback_query: { ...callback, data: 'Confirm refill' } }, ['456'], now)).toThrow();
  });

  it('rolls back intake errors and releases connections rather than acknowledging persistence failure', async () => {
    const db = database(sql => {
      if (sql.startsWith('INSERT INTO telegram_inbox')) throw new Error('synthetic database outage');
      return undefined;
    });
    const app = createApp(config, { telegramInbox: postgresTelegramInbox(db.pool, '123') });
    const response = await request(app).post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', providerEnv.TELEGRAM_WEBHOOK_SECRET).send(message());
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('synthetic database outage');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('deduplicates before consent effects and accepts out-of-order identities without a cursor', async () => {
    const seen = new Set<string>();
    const db = database((sql, values) => {
      if (sql.startsWith('INSERT INTO telegram_inbox')) {
        const id = String(values[1]);
        if (seen.has(id)) return { rowCount: 0, rows: [] };
        seen.add(id);
        return { rowCount: 1, rows: [{ update_id: id }] };
      }
    });
    const inbox = postgresTelegramInbox(db.pool, '123');
    for (const id of [100, 2, 100]) await inbox.ingest(normalizeTelegramUpdate(message(id), ['456'], now)!);
    expect([...seen]).toEqual(['100', '2']);
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('expires_at<=now()'))).toHaveLength(2);
    expect(db.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO telegram_inbox'))
      .every(([sql]) => sql.includes('ON CONFLICT DO NOTHING'))).toBe(true);
  });

  it('locks the active run before claiming and acknowledges only matching owners while purging text and pins', async () => {
    const db = database(sql => {
      if (sql.startsWith('WITH candidates')) return { rowCount: 1, rows: [{ update_id: '2' }] };
      if (sql.includes('SELECT update_id,status')) return { rowCount: 1, rows: [
        { update_id: '2', status: 'CLAIMED', claimed_by_run: ownership.run_id, lease_id: ownership.lease_id, active: true }
      ] };
      if (sql.includes("SET status='DONE'")) return { rowCount: 1, rows: [{ update_id: '2' }] };
    });
    const inbox = postgresTelegramInbox(db.pool, '123');
    expect(await inbox.claim(ownership.run_id, ownership.lease_id, 5)).toEqual({ messages: [{ update_id: '2' }] });
    const sqls = db.query.mock.calls.map(([sql]) => sql);
    expect(sqls.findIndex(sql => sql.includes('FROM agent_run_leases'))).toBeLessThan(sqls.findIndex(sql => sql.startsWith('WITH candidates')));
    expect(sqls.find(sql => sql.startsWith('WITH candidates'))).toContain('FOR UPDATE SKIP LOCKED');
    expect(await inbox.ack(ownership.run_id, ownership.lease_id, ['2', '9'])).toEqual({ acked: 1, not_found: ['9'] });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("text=NULL,token=NULL"))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('latitude=NULL,longitude=NULL'))).toBe(true);
  });

  it.each(['wrong-run', 'wrong-lease', 'expired'] as const)('refuses %s acknowledgements before purge', async reason => {
    const db = database(sql => {
      if (sql.includes('SELECT update_id,status')) return { rowCount: 1, rows: [{
        update_id: '2', status: 'CLAIMED',
        claimed_by_run: reason === 'wrong-run' ? 'other' : ownership.run_id,
        lease_id: reason === 'wrong-lease' ? token : ownership.lease_id, active: reason !== 'expired'
      }] };
    });
    await expect(postgresTelegramInbox(db.pool, '123').ack(ownership.run_id, ownership.lease_id, ['2']))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('latitude=NULL'))).toBe(false);
  });

  it.each(['lease', 'event', 'chat', 'sender', 'button'] as const)('denies %s authorization before provider dispatch', async reason => {
    const db = database(sql => {
      if (reason === 'lease' && sql.includes('FROM agent_run_leases')) return { rowCount: 0, rows: [] };
      if (reason === 'event' && sql.includes('FROM telegram_inbox')) return { rowCount: 0, rows: [] };
    }, { ...event, sender_id: reason === 'sender' ? '789' : '456' });
    const transport = { send: vi.fn(), download: vi.fn(), answer: vi.fn() };
    const args = { ...ownership, chat_id: reason === 'chat' ? '789' : '456',
      text: 'Synthetic text', buttons: [{ token, title: 'Confirm' }], idempotency_key: 'send' };
    await expect(telegramAction(db.pool, config, reason === 'button' ? 'tg_send_buttons' : 'tg_send_text', args, transport))
      .rejects.toMatchObject({ code: reason === 'lease' ? 'LEASE_EXPIRED' : reason === 'button' ? 'CONFIRMATION_INVALID' : 'UNAUTHORIZED' });
    expect(transport.send).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO provider_operations'))).toBe(false);
  });

  it('creates outstanding location access only after a known successful send', async () => {
    const db = database();
    const send = vi.fn(async () => {
      expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO telegram_location_requests'))).toBe(false);
      return { message_id: '7' };
    });
    await telegramAction(db.pool, config, 'tg_request_location',
      { ...ownership, chat_id: '456', purpose: 'pharmacy_lookup', idempotency_key: 'loc' },
      { send, download: vi.fn(), answer: vi.fn() });
    expect(send).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      text: expect.stringContaining('/cancel_location'),
      reply_markup: expect.objectContaining({ one_time_keyboard: true })
    }));
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO telegram_location_requests'))).toBe(true);
  });

  it('never creates consent or redispatches after an ambiguous send', async () => {
    let reserved = false;
    const args = { ...ownership, chat_id: '456', purpose: 'pharmacy_lookup', idempotency_key: 'loc' };
    const db = database(sql => {
      if (sql.startsWith('INSERT INTO provider_operations')) {
        if (reserved) return { rowCount: 0, rows: [] };
        reserved = true;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT operation_key,args_digest')) return { rowCount: 1, rows: [{
        operation_key: 'loc', args_digest: argumentDigest(args), status: 'OUTCOME_UNKNOWN'
      }] };
    });
    const send = vi.fn().mockRejectedValue(new Error('private token diagnostic'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(telegramAction(db.pool, config, 'tg_request_location', args, { send, download: vi.fn(), answer: vi.fn() }))
        .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    }
    expect(send).toHaveBeenCalledOnce();
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO telegram_location_requests'))).toBe(false);
  });

  it('replays known success and blocks changed payload or alternate logical keys', async () => {
    const args = { ...ownership, chat_id: '456', text: 'Synthetic text', idempotency_key: 'send' };
    const db = database(sql => {
      if (sql.startsWith('INSERT INTO provider_operations')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT operation_key,args_digest')) return { rowCount: 1, rows: [{
        operation_key: 'send', args_digest: argumentDigest(args), status: 'SUCCEEDED', result_json: { message_id: '7' }
      }] };
    });
    const transport = { send: vi.fn(), download: vi.fn(), answer: vi.fn() };
    expect(await telegramAction(db.pool, config, 'tg_send_text', args, transport))
      .toEqual({ data: { message_id: '7' }, replayed: true });
    for (const changed of [{ ...args, text: 'changed' }, { ...args, idempotency_key: 'new-key' }]) {
      await expect(telegramAction(db.pool, config, 'tg_send_text', changed, transport)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('keeps dispatched evidence uncertain when owning transaction commit fails', async () => {
    const db = database(sql => {
      if (sql === 'COMMIT') throw new Error('synthetic commit outage');
      return undefined;
    });
    const send = vi.fn().mockResolvedValue({ message_id: '7' });
    await expect(telegramAction(db.pool, config, 'tg_send_text',
      { ...ownership, chat_id: '456', text: 'Synthetic text', idempotency_key: 'send' },
      { send, download: vi.fn(), answer: vi.fn() })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(send).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.release).toHaveBeenCalledOnce();
  });
});
