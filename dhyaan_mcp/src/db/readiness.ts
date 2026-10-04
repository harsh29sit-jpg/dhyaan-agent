import type pg from 'pg';

const migrations = ['001_core.sql', '002_whatsapp_inbox.sql', '003_payment_evidence.sql', '004_telegram_refill.sql'];
const relations = ['tool_call_log', 'agent_run_leases', 'telegram_inbox', 'telegram_locations',
  'pharmacy_lookups', 'refill_requests', 'refill_operations'];

// PUBLIC_INTERFACE
export async function deploymentDatabaseHealthy(pool: pg.Pool): Promise<boolean> {
  /** Check known migration evidence and core refill relations; this is not provider or fulfillment verification. */
  try {
    const applied = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = ANY($1::text[])', [migrations]);
    if (!migrations.every(name => applied.rows.some(row => row.name === name))) return false;
    // Fixed identifiers only: callers cannot supply SQL or relation names.
    for (const relation of relations) {
      await pool.query(`SELECT 1 FROM ${relation} LIMIT 0`);
    }
    return true;
  } catch {
    return false;
  }
}
