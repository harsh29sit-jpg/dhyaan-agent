import type pg from 'pg';
import type { Config } from '../config.js';
import { ToolError } from '../lib/errors.js';
import { privateObjectStore } from '../lib/audio-store.js';
import { telegramTransport } from '../adapters/telegram.js';
import { gnaniTransport } from '../adapters/gnani.js';
import { googleMapsTransport } from '../adapters/google-maps.js';
import { postgresTelegramInbox } from './telegram.js';
import { telegramAction, acknowledgeCallback } from './telegram-actions.js';
import { voiceTool } from './voice.js';
import { nearbyPharmacies } from './location.js';
import { refillTool } from './refill.js';

export interface RevisedMechanics {
  dispatch(tool: string, args: Record<string, unknown>): Promise<{ data: unknown; replayed: boolean }>;
}

// PUBLIC_INTERFACE
export function revisedMechanics(pool: pg.Pool, config: Config): RevisedMechanics {
  /** Wire one service's mechanical stores; create provider clients only after the tool's complete activation gates pass. */
  function requireService(name: 'telegram' | 'gnani' | 'maps' | 'audio') {
    const state = config.services[name];
    if (!state.configured || !state.enabled) throw new ToolError('NOT_CONFIGURED', 'Required integration is disabled or incomplete');
  }
  return {
    async dispatch(tool, args) {
      requireService('telegram');
      const bot = config.telegram.botId!;
      if (tool === 'tg_get_new_messages') {
        return { data: await postgresTelegramInbox(pool, bot).claim(String(args.run_id), String(args.lease_id), Number(args.limit)), replayed: false };
      }
      if (tool === 'tg_ack_messages') {
        return { data: await postgresTelegramInbox(pool, bot).ack(String(args.run_id), String(args.lease_id), args.update_ids as string[]), replayed: false };
      }
      if (tool.startsWith('refill_request_')) {
        const result = await refillTool(pool, bot, tool, args);
        if (tool === 'refill_request_confirm') {
          // Callback feedback cannot roll back or impersonate approval. Failure is truthfully separate.
          try { await acknowledgeCallback(pool, bot, args, telegramTransport(config)); }
          catch { return { ...result, data: { ...(result.data as object), callback_feedback: 'unconfirmed' } }; }
        }
        return result;
      }
      if (tool === 'pharmacy_nearby_lookup') {
        requireService('maps');
        return { data: await nearbyPharmacies(pool, bot, args, googleMapsTransport(config)), replayed: false };
      }
      if (tool.startsWith('voice_')) {
        requireService('gnani'); requireService('audio');
        return voiceTool(pool, bot, tool, args, gnaniTransport(config), telegramTransport(config), privateObjectStore(config));
      }
      if (tool === 'tg_send_audio') requireService('audio');
      return telegramAction(pool, config, tool, args, telegramTransport(config),
        tool === 'tg_send_audio' ? privateObjectStore(config) : undefined);
    }
  };
}
