import { z } from 'zod';
import type { Config } from '../config.js';
import { ToolError } from '../lib/errors.js';
import { upstreamRequest } from '../lib/http.js';

export interface GnaniTransport {
  transcribe(bytes: Buffer, duration: number, language: string): Promise<{ transcript: string; provider_request_id: string }>;
  synthesize(text: string, language: string, voice: string): Promise<Buffer>;
}

// PUBLIC_INTERFACE
export function gnaniTransport(config: Config): GnaniTransport {
  /** Bind only an enabled trusted origin; do not probe credentials or infer account/codec verification. */
  if (!config.services.gnani.configured || !config.services.gnani.enabled) throw new ToolError('NOT_CONFIGURED', 'Gnani is disabled');
  const headers = { 'X-API-Key-ID': config.gnani.key! };
  return {
    async transcribe(bytes, duration, language) {
      if (duration < 1 || duration > 60 || !Number.isInteger(duration) || !bytes.length || bytes.length > 10 * 1024 * 1024 ||
          bytes.subarray(0, 4).toString() !== 'OggS') throw new ToolError('INVALID_ARGUMENT', 'Unsupported or oversized voice; use text fallback');
      const form = new FormData();
      form.set('audio_file', new Blob([new Uint8Array(bytes)], { type: 'audio/ogg' }), 'voice.ogg');
      form.set('language_code', language);
      const response = await upstreamRequest(new URL('/stt/v3', config.gnani.origin),
        { method: 'POST', headers, body: form }, config.upstreamTimeoutMs);
      if (response.status !== 200) throw new ToolError('UPSTREAM_ERROR', 'Transcription rejected; use text fallback');
      try {
        const value = z.object({ success: z.literal(true), transcript: z.string().max(8000), request_id: z.string().min(1).max(160) })
          .parse(JSON.parse(response.bytes.toString()));
        return { transcript: value.transcript, provider_request_id: value.request_id };
      } catch { throw new ToolError('UPSTREAM_ERROR', 'Invalid transcription response'); }
    },
    async synthesize(text, language, voice) {
      if (!text.trim() || text.length > 2000 || voice !== 'Nalini') throw new ToolError('INVALID_ARGUMENT', 'Unreviewed voice or invalid text');
      const response = await upstreamRequest(new URL('/api/v1/tts/inference', config.gnani.origin),
        { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice, model: 'timbre-v2.5', language, speed: 1,
            audio_config: { sample_rate: 48000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' } }) },
        config.upstreamTimeoutMs, 10 * 1024 * 1024);
      if (response.status !== 200 || response.bytes.subarray(0, 4).toString() !== 'RIFF' ||
          response.bytes.subarray(8, 12).toString() !== 'WAVE') throw new ToolError('UPSTREAM_ERROR', 'Invalid binary speech response; use text fallback');
      return response.bytes;
    }
  };
}
