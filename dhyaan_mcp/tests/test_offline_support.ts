import type pg from 'pg';
import { vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { OwnedEvent } from '../src/tools/ownership.js';

export const token = '00000000-0000-4000-8000-000000000002';
export const ownership = {
  run_id: 'RUN-offline', lease_id: '00000000-0000-4000-8000-000000000001',
  source_update_id: '2'
};
// Synthetic values only. No process.env or owner configuration is read.
export const providerEnv = {
  MCP_API_KEY: 'synthetic-independent-mcp-key-only-0001',
  TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123:synthetic_independent_token_only',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic-independent-webhook-secret',
  TELEGRAM_ALLOWED_USER_IDS: '456',
  GNANI_ENABLED: 'true', GNANI_API_KEY_ID: 'synthetic-gnani-key',
  GNANI_BASE_URL: 'https://api.vachana.ai',
  GOOGLE_MAPS_ENABLED: 'true', GOOGLE_MAPS_API_KEY: 'synthetic-maps-key',
  AUDIO_S3_ENDPOINT: 'https://storage.example.test', AUDIO_S3_BUCKET: 'synthetic-audio',
  AUDIO_S3_ACCESS_KEY_ID: 'synthetic-access', AUDIO_S3_SECRET_ACCESS_KEY: 'synthetic-secret',
  AUDIO_S3_REGION: 'synthetic-region'
};
export const config = loadConfig(providerEnv);
export const event: OwnedEvent = {
  bot_id: '123', update_id: '2', sender_id: '456', chat_id: '456', kind: 'callback',
  token, text: null, callback_id: 'synthetic-callback', audio_ref: token,
  location_ref: token, event_at: new Date('2026-01-01T12:00:00Z')
};
export const now = event.event_at.getTime();

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };
type QueryRouter = (sql: string, values: unknown[]) => QueryResult | undefined;

// PUBLIC_INTERFACE
export function database(route: QueryRouter = () => undefined, owned: OwnedEvent = event) {
  /** Explicit offline SQL double; it cannot establish Postgres locking or concurrency guarantees. */
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const custom = route(sql, values);
    if (custom) return custom;
    if (sql.includes('FROM agent_run_leases')) return { rowCount: 1, rows: [{}] };
    if (sql.includes('FROM telegram_inbox') && sql.includes("status='CLAIMED'")) {
      return { rowCount: 1, rows: [owned] };
    }
    if (sql.startsWith('INSERT INTO provider_operations')) return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as pg.PoolClient;
  const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
  return { pool, client, query, release };
}

// PUBLIC_INTERFACE
export function message(updateId = 2) {
  /** Create a registered private synthetic Telegram message at the fixed test time. */
  return {
    update_id: updateId,
    message: {
      message_id: 3, date: Math.floor(now / 1000),
      from: { id: 456, is_bot: false }, chat: { id: 456, type: 'private' }, text: 'Synthetic text'
    }
  };
}
