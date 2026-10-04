import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { dispatchTool, toolCatalog } from '../src/mcp/registry.js';
import { schemas } from '../src/mcp/schemas.js';
import { telegramTransport } from '../src/adapters/telegram.js';
import { gnaniTransport } from '../src/adapters/gnani.js';
import { googleMapsTransport } from '../src/adapters/google-maps.js';
import { privateObjectStore } from '../src/lib/audio-store.js';
import contract from '../contracts/mcp-tools.json' with { type: 'json' };
import { config, ownership, providerEnv, token } from './test_offline_support.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const calls = [
  ['tg_send_text', { ...ownership, chat_id: '456', text: 'Synthetic private medicine', idempotency_key: 'send' }],
  ['voice_transcribe', { ...ownership, audio_ref: token, language_code: 'hi-IN' }],
  ['voice_synthesize', { ...ownership, text: 'Synthetic transcript', language_code: 'hi-IN', voice: 'Nalini', idempotency_key: 'tts' }],
  ['pharmacy_nearby_lookup', { ...ownership, location_ref: token }],
  ['refill_request_get', { ...ownership, request_id: token }],
  ['tg_send_audio', { ...ownership, chat_id: '456', audio_ref: token, idempotency_key: 'audio' }]
] as const;

describe('independent revised configuration and MCP contracts', () => {
  const groups = [
    { name: 'telegram', flag: 'TELEGRAM_ENABLED', keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ALLOWED_USER_IDS'], tools: [0, 1, 2, 3, 4, 5] },
    { name: 'gnani', flag: 'GNANI_ENABLED', keys: ['GNANI_API_KEY_ID', 'GNANI_BASE_URL'], tools: [1, 2] },
    { name: 'maps', flag: 'GOOGLE_MAPS_ENABLED', keys: ['GOOGLE_MAPS_API_KEY'], tools: [3] },
    { name: 'audio', flag: null, keys: ['AUDIO_S3_ENDPOINT', 'AUDIO_S3_BUCKET', 'AUDIO_S3_ACCESS_KEY_ID', 'AUDIO_S3_SECRET_ACCESS_KEY', 'AUDIO_S3_REGION'], tools: [1, 2, 5] }
  ] as const;

  for (const group of groups) {
    it(`denies every incomplete ${group.name} credential subset and disabled flag with zero calls`, async () => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const dispatch = vi.fn();
      const audit = { begin: vi.fn(), finish: vi.fn(), healthy: vi.fn() };
      for (let mask = 0; mask < (1 << group.keys.length) - 1; mask++) {
        const env: NodeJS.ProcessEnv = { ...providerEnv };
        group.keys.forEach((key, bit) => { if (!(mask & (1 << bit))) delete env[key]; });
        const partial = loadConfig(env);
        expect(partial.services[group.name].configured).toBe(false);
        for (const index of group.tools) {
          const [tool, args] = calls[index];
          expect(await dispatchTool(tool, args, partial, { audit, revised: { dispatch } }))
            .toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
        }
      }
      if (group.flag) {
        for (const value of [undefined, 'false']) {
          const env: NodeJS.ProcessEnv = { ...providerEnv, [group.flag]: value };
          expect(loadConfig(env).services[group.name]).toMatchObject({ configured: true, enabled: false, live_verified: false });
          for (const index of group.tools) {
            const [tool, args] = calls[index];
            expect(await dispatchTool(tool, args, loadConfig(env), { audit, revised: { dispatch } }))
              .toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
          }
        }
      }
      expect(dispatch).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it('does not construct disabled providers or private storage and never probes at construction', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const factory of [telegramTransport, gnaniTransport, googleMapsTransport, privateObjectStore]) {
      expect(() => factory(loadConfig({}))).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
      factory(config);
    }
    expect(fetch).not.toHaveBeenCalled();
    const readiness = JSON.stringify(config.services);
    for (const secret of [providerEnv.TELEGRAM_BOT_TOKEN, providerEnv.GNANI_API_KEY_ID, providerEnv.GOOGLE_MAPS_API_KEY]) {
      expect(readiness).not.toContain(secret);
    }
  });

  it('audits before dispatch, hashes private input, preserves replay, and hides internal errors', async () => {
    const records: unknown[] = [];
    const order: string[] = [];
    const audit = {
      begin: vi.fn(async (record: unknown) => { records.push(record); order.push('audit'); }),
      finish: vi.fn(async () => { order.push('finish'); }), healthy: vi.fn()
    };
    const dispatch = vi.fn(async () => { order.push('dispatch'); return { data: { message_id: '7' }, replayed: true }; });
    const [tool, args] = calls[0];
    expect(await dispatchTool(tool, args, config, { audit, revised: { dispatch } }))
      .toMatchObject({ ok: true, replayed: true, data: { message_id: '7' } });
    expect(order).toEqual(['audit', 'dispatch', 'finish']);
    expect(JSON.stringify(records)).not.toContain(args.text);
    expect(records[0]).toMatchObject({ real_service: 'telegram', args_digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    dispatch.mockRejectedValueOnce(new Error('private token-bearing diagnostic'));
    const failure = await dispatchTool(tool, args, config, { audit, revised: { dispatch } });
    expect(failure).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    expect(JSON.stringify(failure)).not.toContain('private token-bearing diagnostic');
  });

  it('blocks missing or failed audit, missing mechanics, and unknown tools', async () => {
    const dispatch = vi.fn();
    const [tool, args] = calls[0];
    expect(await dispatchTool(tool, args, config, { revised: { dispatch } }))
      .toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
    const audit = { begin: vi.fn().mockRejectedValue(new Error('private audit failure')), finish: vi.fn(), healthy: vi.fn() };
    expect(await dispatchTool(tool, args, config, { audit, revised: { dispatch } }))
      .toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
    expect(audit.finish).not.toHaveBeenCalled();
    audit.begin.mockResolvedValue(undefined);
    expect(await dispatchTool(tool, args, config, { audit })).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expect(await dispatchTool('wa_send_text', args, config, { audit, revised: { dispatch } }))
      .toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reports uncertainty if audit completion fails after dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue({ data: { message_id: '7' }, replayed: false });
    const audit = { begin: vi.fn(), finish: vi.fn().mockRejectedValue(new Error('private')), healthy: vi.fn() };
    expect(await dispatchTool(calls[0][0], calls[0][1], config, { audit, revised: { dispatch } }))
      .toMatchObject({ ok: false, error: { code: 'OUTCOME_UNKNOWN', retryable: false } });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('derives catalog parity from schemas and rejects caller-supplied authorization or raw coordinates', () => {
    expect(toolCatalog().map(t => t.name)).toEqual(Object.keys(schemas));
    expect(toolCatalog().map(t => t.name)).toEqual(contract.tools);
    expect(toolCatalog().some(t => /^(wa_|admin|sql|reset|policy_decide)/.test(t.name))).toBe(false);
    for (const [tool, args] of calls) {
      expect(schemas[tool].safeParse(args).success).toBe(true);
      expect(schemas[tool].safeParse({ ...args, sender_id: '456', consent: true }).success).toBe(false);
    }
    expect(schemas.pharmacy_nearby_lookup.parse(calls[3][1])).toMatchObject({ radius_m: 3000, limit: 5 });
    expect(schemas.pharmacy_nearby_lookup.safeParse({ ...calls[3][1], latitude: 12, longitude: 77 }).success).toBe(false);
    expect(schemas.voice_transcribe.safeParse({ ...calls[1][1], media_id: 'legacy-file' }).success).toBe(false);
  });
});
