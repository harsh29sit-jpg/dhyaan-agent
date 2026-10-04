import pg from 'pg';
import type { Config } from '../config.js';

// PUBLIC_INTERFACE
export function createPool(config: Config): pg.Pool | undefined {
  /** Create a bounded pool only with configured TLS connection; never use a memory fallback. */
  if (!config.databaseUrl) return undefined;
  return new pg.Pool({ connectionString: config.databaseUrl, max: 5,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000 });
}
