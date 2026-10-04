import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { dispatchTool } from '../src/mcp/registry.js';
import { normalizeTelegramUpdate } from '../src/routes/telegram-webhook.js';
import { googleMapsTransport } from '../src/adapters/google-maps.js';
import { gnaniTransport } from '../src/adapters/gnani.js';
import { telegramTransport } from '../src/adapters/telegram.js';
import { postgresTelegramInbox } from '../src/tools/telegram.js';
import { nearbyPharmacies } from '../src/tools/location.js';
import { refillTool } from '../src/tools/refill.js';
import { resolveAudio } from '../src/lib/audio-store.js';
import { transaction } from '../src/tools/ownership.js';
import { executeOnce } from '../src/lib/idempotency.js';

const lease = { run_id: 'RUN-1', lease_id: '00000000-0000-4000-8000-000000000001', source_update_id: '2' };
const token = '00000000-0000-4000-8000-000000000002';
const env = {
  MCP_API_KEY: 'synthetic-offline-mcp-key-only-0001',
  TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123:synthetic_token_not_a_real_secret',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic-webhook-secret-only-000001', TELEGRAM_ALLOWED_USER_IDS: '456',
  GNANI_ENABLED: 'true', GNANI_BASE_URL: 'https://api.vachana.ai', GNANI_API_KEY_ID: 'synthetic',
  GOOGLE_MAPS_ENABLED: 'true', GOOGLE_MAPS_API_KEY: 'synthetic'
};
const message = () => ({ update_id: 2, message: { message_id: 3, date: Math.floor(Date.now() / 1000),
  from: { id: 456, is_bot: false }, chat: { id: 456, type: 'private' }, text: 'hello' } });
const event = { bot_id: '123', update_id: '2', sender_id: '456', chat_id: '456',
  kind: 'callback', token, text: null, location_ref: token, event_at: new Date() };
const audit = { begin: vi.fn(), finish: vi.fn(), healthy: vi.fn() };
const poolWith = (query: ReturnType<typeof vi.fn>) => ({
  query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() })
}) as unknown as pg.Pool;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('revised offline mechanics', () => {
  it('returns uncertainty after a dispatched-workflow commit failure', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('synthetic connection failure');
      return { rowCount: 1, rows: [] };
    });
    await expect(transaction(poolWith(query), async () => ({ message_id: '1' }), true))
      .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(query.mock.calls.some(c => c[0] === 'ROLLBACK')).toBe(true);
  });
  it('writes external success only through the owning state transaction', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const commitQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    expect(await executeOnce(poolWith(query), { tool: 'tg_send_text', key: 'one', args: {} },
      async () => ({ message_id: '1' }), { query: commitQuery } as unknown as pg.PoolClient))
      .toEqual({ data: { message_id: '1' }, replayed: false });
    expect(query.mock.calls.some(c => String(c[0]).includes("status='SUCCEEDED'"))).toBe(false);
    expect(commitQuery.mock.calls[0]![0]).toContain("status='SUCCEEDED'");
  });
  it('defaults providers off and refuses complete credentials without explicit enablement', async () => {
    const dispatch = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const config of [loadConfig({ MCP_API_KEY: env.MCP_API_KEY }),
      loadConfig({ ...env, TELEGRAM_ENABLED: 'false' }),
      loadConfig({ ...env, TELEGRAM_BOT_TOKEN: '' })]) {
      expect(await dispatchTool('tg_send_text', { ...lease, chat_id: '456', text: 'hello', idempotency_key: 'one' },
        config, { audit, revised: { dispatch } })).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(loadConfig({}).services.gnani).toMatchObject({ enabled: false, live_verified: false });
  });
  it('rejects unsafe flags origins identifiers and reused webhook secrets', () => {
    expect(() => loadConfig({ TELEGRAM_ENABLED: 'yes' })).toThrow();
    expect(() => loadConfig({ TELEGRAM_ALLOWED_USER_IDS: '-123' })).toThrow();
    expect(() => loadConfig({ GNANI_BASE_URL: 'https://attacker.test' })).toThrow();
    expect(() => loadConfig({ ...env, TELEGRAM_WEBHOOK_SECRET: env.MCP_API_KEY })).toThrow();
    expect(JSON.stringify(loadConfig(env).services)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });
  it('authenticates before intake and returns 503 on commit failure', async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const app = createApp(loadConfig(env), { telegramInbox: { ingest, claim: vi.fn(), ack: vi.fn() } });
    expect((await request(app).post('/webhooks/telegram').send(message())).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    const post = () => request(app).post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', env.TELEGRAM_WEBHOOK_SECRET).send(message());
    expect((await post()).status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ sender_id: '456', kind: 'text' }));
    ingest.mockRejectedValueOnce(new Error('private diagnostic'));
    const failed = await post();
    expect(failed.status).toBe(503);
    expect(failed.text).not.toContain('private diagnostic');
  });
  it('ignores groups unknown users edits live and stale locations', () => {
    const update = message();
    expect(normalizeTelegramUpdate(update, [])).toBeNull();
    expect(normalizeTelegramUpdate({ ...update, edited_message: update.message }, ['456'])).toBeNull();
    expect(normalizeTelegramUpdate({ ...update, message: { ...update.message,
      chat: { id: -1, type: 'group' } } }, ['456'])).toBeNull();
    const location = { ...update.message, text: undefined, location: { latitude: 12, longitude: 77, live_period: 60 } };
    expect(normalizeTelegramUpdate({ ...update, message: location }, ['456'])).toBeNull();
    expect(() => normalizeTelegramUpdate({ ...update, message: { ...location,
      location: { latitude: 91, longitude: 77 } } }, ['456'])).toThrow();
  });
  it('does not reset duplicate updates and requires a matching lease', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const inbox = postgresTelegramInbox(poolWith(query), '123');
    await inbox.ingest(normalizeTelegramUpdate(message(), ['456'])!);
    expect(query.mock.calls.some(c => String(c[0]).includes('UPDATE telegram_locations'))).toBe(false);
    await expect(inbox.claim('RUN-1', lease.lease_id, 20)).rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
    await expect(inbox.ack('RUN-1', lease.lease_id, ['2'])).rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
  });
  it('blocks Maps without current consent and cannot purge an unauthorized reference', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM agent_run_leases')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM telegram_inbox')) return { rowCount: 1, rows: [event] };
      return { rowCount: 0, rows: [] };
    });
    const nearby = vi.fn();
    await expect(nearbyPharmacies(poolWith(query), '123',
      { ...lease, location_ref: token, radius_m: 3000, limit: 5 }, { nearby }))
      .rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    expect(nearby).not.toHaveBeenCalled();
    expect(query.mock.calls.some(c => String(c[0]).includes('latitude=NULL'))).toBe(false);
  });
  it('uses exact Places request fields and distance ranking, with truthful failures', async () => {
    const p = (id: string, lat: number) => ({ id, displayName: { text: id }, formattedAddress: 'Synthetic address',
      location: { latitude: lat, longitude: 77 }, googleMapsUri: 'https://maps.google.com/?cid=123' });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [p('far', 12.01), p('near', 12.001)] })));
    vi.stubGlobal('fetch', fetch);
    const maps = googleMapsTransport(loadConfig(env));
    expect((await maps.nearby(12, 77, 3000, 5)).map(p => p.place_id)).toEqual(['near', 'far']);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(JSON.parse(options.body)).toMatchObject({ includedTypes: ['pharmacy'], rankPreference: 'DISTANCE', maxResultCount: 5 });
    fetch.mockResolvedValueOnce(new Response('{}'));
    expect(await maps.nearby(12, 77, 3000, 5)).toEqual([]);
    fetch.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await expect(maps.nearby(12, 77, 3000, 5)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ places: [p('bad', 99)] })));
    await expect(maps.nearby(12, 77, 3000, 5)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'synthetic error' } })));
    await expect(maps.nearby(12, 77, 3000, 5)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
  it('parses STT without confidence and TTS as binary WAV', async () => {
    const wav = Buffer.from('RIFF0000WAVEsynthetic');
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: true, transcript: 'Synthetic medicine', request_id: 'synthetic-1'
    }))).mockResolvedValueOnce(new Response(wav));
    vi.stubGlobal('fetch', fetch);
    const gnani = gnaniTransport(loadConfig(env));
    const result = await gnani.transcribe(Buffer.from('OggSsynthetic'), 60, 'hi-IN');
    expect(result).toEqual({ transcript: 'Synthetic medicine', provider_request_id: 'synthetic-1' });
    expect(await gnani.synthesize('hello', 'hi-IN', 'Nalini')).toEqual(wav);
    await expect(gnani.transcribe(Buffer.from('OggS'), 61, 'hi-IN')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects hostile Telegram file metadata without downloading', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, result: { file_id: 'file', file_size: 20, file_path: '../private' }
    })));
    vi.stubGlobal('fetch', fetch);
    await expect(telegramTransport(loadConfig(env)).download('file')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not resolve expired or foreign audio references', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(resolveAudio({ query } as unknown as pg.PoolClient,
      { ...event, message_id: '3', audio_ref: token, callback_id: null } as never, token))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(query.mock.calls[0]![0]).toContain('expires_at>now()');
    expect(query.mock.calls[0]![1]).toContain('456');
  });
  it('records confirmation only as pending handoff and performs no provider action', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM agent_run_leases')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM telegram_inbox')) return { rowCount: 1, rows: [event] };
      if (sql.includes('FROM refill_requests')) return { rowCount: 1, rows: [{
        request_id: token, source_update_id: '1', token_digest: createHash('sha256').update(token).digest('hex'),
        status: 'AWAITING_CONFIRMATION', expires_at: new Date(event.event_at.getTime() + 599000)
      }] };
      return { rowCount: 0, rows: [] };
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await refillTool(poolWith(query), '123', 'refill_request_confirm',
      { ...lease, request_id: token, token, idempotency_key: 'one' }))
      .toMatchObject({ data: { status: 'PENDING_HANDOFF', fulfillment_verified: false } });
    expect(fetch).not.toHaveBeenCalled();
    expect(query.mock.calls.some(c => String(c[0]).includes("status='PENDING_HANDOFF'"))).toBe(true);
  });
  it('refuses callback-label or cross-token confirmation', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM agent_run_leases')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM telegram_inbox')) return { rowCount: 1, rows: [{ ...event, token: null }] };
      if (sql.includes('FROM refill_requests')) return { rowCount: 1, rows: [{
        source_update_id: '1', token_digest: createHash('sha256').update(token).digest('hex'),
        status: 'AWAITING_CONFIRMATION', expires_at: new Date(Date.now() + 600000)
      }] };
      return { rowCount: 0, rows: [] };
    });
    await expect(refillTool(poolWith(query), '123', 'refill_request_confirm',
      { ...lease, request_id: token, token, idempotency_key: 'one' })).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
  });
});
