import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

// PUBLIC_INTERFACE
export async function migrate(): Promise<void> {
  /** Apply known additive migration files atomically; connection is requested from the owner. */
  const pool = createPool(loadConfig());
  if (!pool) throw new Error('DATABASE_URL is required');
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dhyaan-migrations'))");
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const name of ['001_core.sql', '002_whatsapp_inbox.sql', '003_payment_evidence.sql', '004_telegram_refill.sql']) {
        const found = await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name]);
        if (found.rowCount) continue;
        // Files are a fixed allowlist, never paths provided through MCP.
        const sql = await readFile(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().then(() => console.info('Additive migrations applied')).catch(() => {
    console.error('Migration failed; inspect protected database diagnostics');
    process.exitCode = 1;
  });
}
