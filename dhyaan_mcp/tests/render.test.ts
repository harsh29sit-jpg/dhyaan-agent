import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { deploymentDatabaseHealthy } from '../src/db/readiness.js';
import { toolCatalog, type Dependencies } from '../src/mcp/registry.js';

const config = loadConfig({
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://synthetic.onrender.com',
  ALLOWED_ORIGINS: 'https://synthetic-client.test',
  MCP_API_KEY: 'synthetic-render-mcp-key-only-0001',
  ADMIN_TOKEN: 'synthetic-render-admin-key-only-01',
  DATABASE_URL: 'postgresql://synthetic:synthetic@db.example.test/demo?sslmode=verify-full'
});
const dependencies = (): Dependencies => ({
  audit: { begin: vi.fn(), finish: vi.fn(), healthy: vi.fn().mockResolvedValue(true) },
  runs: { acquire: vi.fn(), release: vi.fn() },
  revised: { dispatch: vi.fn() },
  deploymentHealthy: vi.fn().mockResolvedValue(true)
});

describe('Render deployment boundary', () => {
  it('permits hosting readiness without claiming whole-application or fulfillment readiness', async () => {
    const app = createApp(config, dependencies());
    const transport = await request(app).get('/health/transport');
    expect(transport.status).toBe(200);
    expect(transport.headers['cache-control']).toBe('no-store');
    expect(transport.body).toMatchObject({ ready: true, scope: 'mcp_transport',
      database: true, audit: true, fulfillment_verified: false, provider_live_verified: false });
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.ready).toBe(false);
    expect(JSON.stringify(transport.body)).not.toContain(config.mcpKey);
    expect(JSON.stringify(transport.body)).not.toContain(config.databaseUrl);
  });
  it('refuses missing core configuration and missing persistence wiring', async () => {
    for (const [local, deps] of [
      [loadConfig({}), dependencies()],
      [config, {}],
      [config, { ...dependencies(), runs: undefined }],
      [config, { ...dependencies(), revised: undefined }]
    ] as const) {
      expect((await request(createApp(local, deps)).get('/health/transport')).status).toBe(503);
    }
  });
  it('sanitizes database and audit failures', async () => {
    for (const deps of [
      { ...dependencies(), deploymentHealthy: vi.fn().mockRejectedValue(new Error('private-database-detail')) },
      { ...dependencies(), audit: { begin: vi.fn(), finish: vi.fn(),
        healthy: vi.fn().mockRejectedValue(new Error('private-audit-detail')) } }
    ]) {
      const result = await request(createApp(config, deps)).get('/health/transport');
      expect(result.status).toBe(503);
      expect(result.text).not.toContain('private-');
    }
  });
  it('requires all applied migrations and checks refill relations read-only', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { name: '001_core.sql' }, { name: '002_whatsapp_inbox.sql' },
      { name: '003_payment_evidence.sql' }, { name: '004_telegram_refill.sql' }
    ] });
    expect(await deploymentDatabaseHealthy({ query } as unknown as pg.Pool)).toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1 FROM refill_requests LIMIT 0');
    expect(query.mock.calls.every(([sql]) => String(sql).startsWith('SELECT'))).toBe(true);
    query.mockResolvedValueOnce({ rows: [{ name: '001_core.sql' }] });
    expect(await deploymentDatabaseHealthy({ query } as unknown as pg.Pool)).toBe(false);
    query.mockRejectedValueOnce(new Error('private connection string'));
    expect(await deploymentDatabaseHealthy({ query } as unknown as pg.Pool)).toBe(false);
  });
  it('does not report success if a migrated relation is unavailable', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('schema_migrations')) return { rows: [
        { name: '001_core.sql' }, { name: '002_whatsapp_inbox.sql' },
        { name: '003_payment_evidence.sql' }, { name: '004_telegram_refill.sql' }
      ] };
      throw new Error('missing relation');
    });
    expect(await deploymentDatabaseHealthy({ query } as unknown as pg.Pool)).toBe(false);
  });
  it('marks only the local request getter read-only, not consuming discovery or confirmation', () => {
    const catalog = toolCatalog();
    const get = (name: string) => catalog.find(tool => tool.name === name)!;
    expect(get('refill_request_get').annotations?.readOnlyHint).toBe(true);
    for (const name of ['refill_request_prepare', 'refill_request_confirm', 'pharmacy_nearby_lookup']) {
      expect(get(name).annotations?.readOnlyHint).toBe(false);
    }
    expect(get('pharmacy_nearby_lookup').annotations?.destructiveHint).toBe(true);
    expect(get('refill_request_confirm').description).toContain('PENDING_HANDOFF');
    expect(get('refill_request_get').description).toContain('Does not verify stock');
  });
});
