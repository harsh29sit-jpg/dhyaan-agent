import { z } from 'zod';
import type { Config } from '../config.js';
import { ToolError } from '../lib/errors.js';
import { upstreamRequest } from '../lib/http.js';

const messageResult = z.object({ message_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export interface TelegramTransport {
  send(method: 'sendMessage' | 'sendAudio', body: Record<string, unknown> | FormData): Promise<{ message_id: string }>;
  download(fileId: string): Promise<Buffer>;
  answer(callbackId: string): Promise<void>;
}

// PUBLIC_INTERFACE
export function telegramTransport(config: Config): TelegramTransport {
  /** Bind only a fully enabled private-chat bot; never register webhooks or start polling. */
  if (!config.services.telegram.enabled || !config.services.telegram.configured) throw new ToolError('NOT_CONFIGURED', 'Telegram is disabled');
  const base = `https://api.telegram.org/bot${config.telegram.token}/`;
  async function call(method: string, body: Record<string, unknown> | FormData) {
    const multipart = body instanceof FormData;
    const response = await upstreamRequest(new URL(method, base), { method: 'POST',
      headers: multipart ? undefined : { 'Content-Type': 'application/json' },
      body: multipart ? body : JSON.stringify(body) }, config.upstreamTimeoutMs);
    if (response.status !== 200) throw new ToolError('UPSTREAM_ERROR', 'Telegram rejected the operation');
    let parsed: unknown;
    try { parsed = JSON.parse(response.bytes.toString('utf8')); }
    catch { throw new ToolError('UPSTREAM_ERROR', 'Invalid Telegram response'); }
    const result = z.object({ ok: z.literal(true), result: z.unknown() }).safeParse(parsed);
    if (!result.success) throw new ToolError('UPSTREAM_ERROR', 'Invalid Telegram response');
    return result.data.result;
  }
  return {
    async send(method, body) {
      const result = messageResult.safeParse(await call(method, body));
      if (!result.success) throw new ToolError('UPSTREAM_ERROR', 'Missing Telegram message identity');
      return { message_id: String(result.data.message_id) };
    },
    async answer(callbackId) {
      if (await call('answerCallbackQuery', { callback_query_id: callbackId }) !== true) {
        throw new ToolError('UPSTREAM_ERROR', 'Callback acknowledgement failed');
      }
    },
    async download(fileId) {
      const file = z.object({ file_id: z.literal(fileId), file_size: z.number().int().positive().max(10 * 1024 * 1024),
        file_path: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/) }).safeParse(await call('getFile', { file_id: fileId }));
      if (!file.success || file.data.file_path.includes('..')) throw new ToolError('INVALID_ARGUMENT', 'Unsafe or oversized audio file metadata');
      const url = new URL(`https://api.telegram.org/file/bot${config.telegram.token}/${file.data.file_path}`);
      const response = await upstreamRequest(url, { method: 'GET' }, config.upstreamTimeoutMs, 10 * 1024 * 1024);
      if (response.status !== 200 || response.bytes.length !== file.data.file_size ||
          response.bytes.subarray(0, 4).toString() !== 'OggS') throw new ToolError('UPSTREAM_ERROR', 'Unsupported Telegram audio; use text fallback');
      return response.bytes;
    }
  };
}
