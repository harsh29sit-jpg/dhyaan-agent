import { afterEach, describe, expect, it, vi } from 'vitest';
import { gnaniTransport } from '../src/adapters/gnani.js';
import { telegramTransport } from '../src/adapters/telegram.js';
import { privateObjectStore, resolveAudio, saveAudio } from '../src/lib/audio-store.js';
import { voiceTool } from '../src/tools/voice.js';
import { telegramAction } from '../src/tools/telegram-actions.js';
import { config, database, event, ownership, providerEnv, token } from './test_offline_support.js';

const wav = Buffer.from('RIFF0000WAVEsynthetic');
const ogg = Buffer.from('OggSsynthetic');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent voice and private audio contracts', () => {
  it.each([
    [Buffer.alloc(0), 1], [ogg, 0], [ogg, 61], [ogg, 1.5],
    [Buffer.from('RIFFwrong codec'), 1], [Buffer.alloc(10 * 1024 * 1024 + 1), 1]
  ])('rejects invalid STT media or duration before network dispatch (%#)', async (bytes, duration) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(gnaniTransport(config).transcribe(bytes, duration, 'hi-IN'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('text fallback') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts exact byte/duration limits and freezes multipart STT contract without invented confidence', async () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024);
    bytes.write('OggS');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, transcript: 'Synthetic transcript', request_id: 'synthetic-request', confidence: 0.99
    })));
    vi.stubGlobal('fetch', fetch);
    expect(await gnaniTransport(config).transcribe(bytes, 60, 'hi-IN'))
      .toEqual({ transcript: 'Synthetic transcript', provider_request_id: 'synthetic-request' });
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.vachana.ai/stt/v3');
    expect(options.headers).toEqual({ 'X-API-Key-ID': providerEnv.GNANI_API_KEY_ID });
    expect(options.redirect).toBe('error');
    expect(options.body.get('language_code')).toBe('hi-IN');
    expect(options.body.get('audio_file').size).toBe(bytes.length);
    expect(options.body.get('audio_file').type).toBe('audio/ogg');
  });

  it.each([
    { success: false, transcript: 'private', request_id: 'id' },
    { success: true, transcript: 'private' },
    { success: true, transcript: 'x'.repeat(8001), request_id: 'id' }
  ])('rejects malformed STT responses without exposing their contents (%#)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(gnaniTransport(config).transcribe(ogg, 1, 'hi-IN'))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Invalid transcription response' });
  });

  it('freezes binary WAV synthesis request and rejects JSON URLs or unreviewed voices', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(wav))
      .mockResolvedValueOnce(new Response('{"audio_url":"https://private.example.test/audio"}'));
    vi.stubGlobal('fetch', fetch);
    const gnani = gnaniTransport(config);
    expect(await gnani.synthesize('Synthetic text', 'hi-IN', 'Nalini')).toEqual(wav);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.vachana.ai/api/v1/tts/inference');
    expect(JSON.parse(options.body)).toEqual({
      text: 'Synthetic text', voice: 'Nalini', model: 'timbre-v2.5', language: 'hi-IN', speed: 1,
      audio_config: { sample_rate: 48000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' }
    });
    await expect(gnani.synthesize('Synthetic text', 'hi-IN', 'Nalini')).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR', message: expect.stringContaining('text fallback')
    });
    for (const [text, voice] of [['', 'Nalini'], ['x'.repeat(2001), 'Nalini'], ['text', 'Unreviewed']]) {
      await expect(gnani.synthesize(text!, 'hi-IN', voice!)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['../private', 'voice/../private', 'https://attacker.test/audio', 'voice/a?token=private'])(
    'refuses hostile getFile metadata %s before downloading', async path => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ok: true, result: { file_id: 'file', file_size: ogg.length, file_path: path }
      })));
      vi.stubGlobal('fetch', fetch);
      await expect(telegramTransport(config).download('file')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it('downloads only matching bounded OGG metadata from the fixed origin without redirects', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, result: { file_id: 'file', file_size: ogg.length, file_path: 'voice/synthetic.ogg' }
    }))).mockResolvedValueOnce(new Response(ogg));
    vi.stubGlobal('fetch', fetch);
    expect(await telegramTransport(config).download('file')).toEqual(ogg);
    const [url, options] = fetch.mock.calls[1]!;
    expect(new URL(String(url)).origin).toBe('https://api.telegram.org');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it.each(['mismatch', 'codec', 'redirect', 'oversized'] as const)('provides redacted download failure for %s', async reason => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, result: { file_id: 'file', file_size: ogg.length, file_path: 'voice/synthetic.ogg' }
    })));
    if (reason === 'redirect') fetch.mockRejectedValueOnce(new Error(`private ${providerEnv.TELEGRAM_BOT_TOKEN}`));
    else fetch.mockResolvedValueOnce(new Response(reason === 'oversized' ? Buffer.alloc(10 * 1024 * 1024 + 1) :
      reason === 'codec' ? Buffer.from('RIFFsynthetic') : Buffer.from('OggSshort')));
    vi.stubGlobal('fetch', fetch);
    await expect(telegramTransport(config).download('file')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves audio by bot/sender/chat/source and expiry before any provider or storage access', async () => {
    const db = database();
    await expect(resolveAudio(db.client, event, token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const resolveCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM private_audio'))!;
    expect(resolveCall[0]).toContain('expires_at>now()');
    expect(resolveCall[1]).toEqual([token, '123', '456', '456', '2']);
    const gnani = { transcribe: vi.fn(), synthesize: vi.fn() };
    const telegram = { send: vi.fn(), download: vi.fn(), answer: vi.fn() };
    const store = { put: vi.fn(), get: vi.fn(), remove: vi.fn() };
    await expect(voiceTool(db.pool, '123', 'voice_transcribe',
      { ...ownership, audio_ref: token, language_code: 'hi-IN' }, gnani, telegram, store))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(telegram.download).not.toHaveBeenCalled();
    expect(gnani.transcribe).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  });

  it('rejects a resolved reference that is not the current voice event', async () => {
    const db = database(sql => sql.includes('FROM private_audio') ? { rowCount: 1, rows: [{
      audio_ref: token, file_id: 'file', duration_seconds: 1
    }] } : undefined, { ...event, audio_ref: null });
    const telegram = { send: vi.fn(), download: vi.fn(), answer: vi.fn() };
    await expect(voiceTool(db.pool, '123', 'voice_transcribe',
      { ...ownership, audio_ref: token, language_code: 'hi-IN' },
      { transcribe: vi.fn(), synthesize: vi.fn() }, telegram, { put: vi.fn(), get: vi.fn(), remove: vi.fn() }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(telegram.download).not.toHaveBeenCalled();
  });

  it('stores private WAV and returns only an opaque one-hour reference', async () => {
    const db = database();
    const store = { put: vi.fn(), get: vi.fn(), remove: vi.fn() };
    const result = await saveAudio(db.client, event, wav, store);
    expect(result).toEqual({ audio_ref: expect.stringMatching(/^[0-9a-f-]{36}$/), expires_in_seconds: 3600 });
    expect(store.put).toHaveBeenCalledWith(`dhyaan-audio/${result.audio_ref}`, wav, 'audio/wav');
    expect(db.query.mock.calls[0]![0]).toContain("now()+interval '1 hour'");
    expect(JSON.stringify(result)).not.toMatch(/object_key|https:|RIFF/);
    for (const bytes of [Buffer.alloc(0), ogg, Buffer.from('RIFF0000FAIL'), Buffer.alloc(10 * 1024 * 1024 + 1)]) {
      await expect(saveAudio(db.client, event, bytes, store)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    }
    expect(store.put).toHaveBeenCalledOnce();
  });

  it('sends synthesized WAV as audio multipart rather than an Opus voice note', async () => {
    const db = database(sql => sql.includes('FROM private_audio') ? { rowCount: 1, rows: [{
      audio_ref: token, object_key: `dhyaan-audio/${token}`, media_type: 'audio/wav'
    }] } : undefined);
    const send = vi.fn().mockResolvedValue({ message_id: '7' });
    const store = { put: vi.fn(), get: vi.fn().mockResolvedValue(wav), remove: vi.fn() };
    await telegramAction(db.pool, config, 'tg_send_audio',
      { ...ownership, chat_id: '456', audio_ref: token, idempotency_key: 'send-audio' },
      { send, download: vi.fn(), answer: vi.fn() }, store);
    const [method, form] = send.mock.calls[0]!;
    expect(method).toBe('sendAudio');
    expect(form.get('chat_id')).toBe('456');
    expect(form.get('audio').type).toBe('audio/wav');
    expect(form.get('audio').name).toBe('speech.wav');
  });

  it('signs private storage requests without public ACLs and rejects arbitrary keys before fetch', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = privateObjectStore(config);
    await expect(store.get('../private')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetch).not.toHaveBeenCalled();
    await store.put(`dhyaan-audio/${token}`, wav, 'audio/wav');
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${providerEnv.AUDIO_S3_ENDPOINT}/${providerEnv.AUDIO_S3_BUCKET}/dhyaan-audio/${token}`);
    expect(options.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(options.headers['x-amz-acl']).toBeUndefined();
    expect(options.redirect).toBe('error');
  });
});
