import type pg from 'pg';
import type { GnaniTransport } from '../adapters/gnani.js';
import type { TelegramTransport } from '../adapters/telegram.js';
import type { AudioObjectStore } from '../lib/audio-store.js';
import { resolveAudio, saveAudio } from '../lib/audio-store.js';
import { executeOnce } from '../lib/idempotency.js';
import { ToolError } from '../lib/errors.js';
import { ownedEvent, transaction } from './ownership.js';

// PUBLIC_INTERFACE
export async function voiceTool(pool: pg.Pool, bot: string, tool: string, args: Record<string, unknown>,
  gnani: GnaniTransport, telegram: TelegramTransport, audio: AudioObjectStore) {
  /** Resolve bounded same-event media; never return raw audio, storage keys, download paths or fabricated confidence. */
  return transaction(pool, async client => {
    const event = await ownedEvent(client, bot, args);
    if (tool === 'voice_transcribe') {
      const ref = await resolveAudio(client, event, String(args.audio_ref));
      if (!ref.file_id || !ref.duration_seconds || event.audio_ref !== ref.audio_ref) {
        throw new ToolError('INVALID_ARGUMENT', 'Current Telegram voice reference required');
      }
      const bytes = await telegram.download(ref.file_id);
      return { data: await gnani.transcribe(bytes, ref.duration_seconds, String(args.language_code)), replayed: false };
    }
    return executeOnce(pool, { tool, key: String(args.idempotency_key),
      logicalKey: `${bot}:${event.update_id}:speech`, args }, async () => {
      const bytes = await gnani.synthesize(String(args.text), String(args.language_code), String(args.voice));
      return saveAudio(client, event, bytes, audio);
    }, client);
  }, true);
}
