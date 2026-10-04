import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { toolCatalog } from '../src/mcp/registry.js';
import type { AuditRecord, AuditSink } from '../src/lib/audit.js';
import contract from '../contracts/mcp-tools.json';

const key = 'synthetic-offline-test-key-only-0001';
const config = loadConfig({ MCP_API_KEY: key, PUBLIC_BASE_URL: 'http://127.0.0.1:3000', ALLOWED_ORIGINS: 'http://127.0.0.1:3000' });
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

describe('MCP bootstrap', () => {
  it('refuses absent/wrong bearer and invalid origin/host', async () => {
    const app = createApp(config);
    expect((await request(app).post('/mcp').send({})).status).toBe(401);
    expect((await request(app).post('/mcp').set('Authorization', 'Bearer wrong').send({})).status).toBe(401);
    expect((await request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Host', '127.0.0.1:3000')
      .set('Origin', 'https://attacker.test').send({})).status).toBe(403);
    expect((await request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Host', 'attacker.test').send({})).status).toBe(403);
  });
  it('has honest public health and refuses premature webhook acknowledgement', async () => {
    const app = createApp(loadConfig({}));
    expect((await request(app).get('/health/live')).status).toBe(200);
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.ready).toBe(false);
    expect((await request(app).post('/mcp').send({})).status).toBe(503);
    expect((await request(app).post('/webhooks/whatsapp').send({ entry: [] })).status).toBe(404);
    expect((await request(app).post('/webhooks/telegram').send({ update_id: 1 })).status).toBe(503);
  });
  it('enforces body and shared call bounds', async () => {
    const app = createApp(config);
    const call = () => request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Host', '127.0.0.1:3000');
    expect((await call().send({ value: 'x'.repeat(300000) })).status).toBe(413);
    for (let i = 0; i < 99; i++) await call().send({});
    expect((await call().send({})).status).toBe(429);
  });
  it('discovers the revised saved schemas and returns audited NOT_CONFIGURED with a real SDK client', async () => {
    const records: AuditRecord[] = [];
    const results: string[] = [];
    const audit: AuditSink = {
      async begin(record) { records.push(record); },
      async finish(_id, code) { results.push(code); },
      async healthy() { return true; }
    };
    // Explicit test double, never an application fallback.
    const local = loadConfig({ MCP_API_KEY: key, PUBLIC_BASE_URL: 'http://127.0.0.1:3000' });
    const server = createApp(local, { audit }).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    local.publicOrigin = `http://127.0.0.1:${address.port}`;
    const client = new Client({ name: 'offline-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${local.publicOrigin}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
      const listed = await client.listTools();
      expect(listed.tools.map(t => t.name)).toEqual(toolCatalog().map(t => t.name));
      expect(listed.tools.map(t => t.name)).toEqual(contract.tools);
      expect(listed.tools.some(t => t.name.startsWith('wa_'))).toBe(false);
      for (const tool of listed.tools) expect(tool.inputSchema.type).toBe('object');
      expect(listed.tools.some(t => /admin|reset|policy_decide|sql/.test(t.name))).toBe(false);
      const reply = await client.callTool({ name: 'gmail_get_message', arguments: { message_id: 'synthetic-message-1' } });
      const content = reply.content as { type: string; text: string }[];
      expect(JSON.parse(content[0]!.text).error.code).toBe('NOT_CONFIGURED');
      expect(results).toEqual(['NOT_CONFIGURED']);
      expect(records[0]!.real_service).toBe('gmail');
      expect(JSON.stringify(records)).not.toContain('synthetic-message-1');
      expect(JSON.stringify(records)).not.toContain(key);
    } finally { await client.close(); }
  });
});
