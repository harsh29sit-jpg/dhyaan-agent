import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { toolCatalog } from '../src/mcp/registry.js';

// PUBLIC_INTERFACE
export async function renderSmoke(): Promise<void> {
  /** Verify HTTPS hosting, authenticated discovery and a bounded lease write/release; never invoke providers or order tools. */
  // Request PUBLIC_BASE_URL and MCP_API_KEY through protected owner configuration.
  // No .env loading, credential output, webhook registration or purchasing occurs here.
  const config = loadConfig();
  assert(config.publicOrigin?.startsWith('https://'), 'HTTPS origin required');
  assert(config.mcpKey, 'MCP_API_KEY required');
  const origin = config.publicOrigin;
  const signal = AbortSignal.timeout(30000);
  const live = await fetch(`${origin}/health/live`, { signal, redirect: 'error' });
  assert.equal(live.status, 200);
  assert.equal((await live.json() as { live?: boolean }).live, true);
  const ready = await fetch(`${origin}/health/transport`, { signal, redirect: 'error' });
  assert.equal(ready.status, 200);
  const health = await ready.json() as { ready?: boolean; scope?: string; fulfillment_verified?: boolean };
  assert.equal(health.ready, true);
  assert.equal(health.scope, 'mcp_transport');
  assert.equal(health.fulfillment_verified, false);
  const denied = await fetch(`${origin}/mcp`, { method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);

  const client = new Client({ name: 'dhyaan-render-smoke', version: '1.0.0' });
  const run = `render-smoke:${randomUUID()}`;
  let lease: string | undefined;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
    assert.notEqual(result.isError, true);
    const content = result.content as { type: string; text?: string }[];
    const text = content.find(item => item.type === 'text')?.text;
    assert(text);
    const envelope = JSON.parse(text) as { ok?: boolean; data?: Record<string, unknown> };
    assert.equal(envelope.ok, true);
    assert(envelope.data);
    return envelope.data;
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { signal, redirect: 'error', headers: { Authorization: `Bearer ${config.mcpKey}` } }
    }));
    const listed = await client.listTools(undefined, { timeout: 10000 });
    assert.deepEqual(listed.tools.map(tool => tool.name), toolCatalog().map(tool => tool.name));
    const acquired = await call('run_acquire', { run_id: run, ttl_seconds: 30 });
    assert.equal(typeof acquired.lease_id, 'string');
    lease = String(acquired.lease_id);
    const released = await call('run_release', { run_id: run, lease_id: lease });
    assert.equal(released.released, true);
    lease = undefined;
    console.info('PASS: HTTPS, transport health, auth refusal, SDK discovery and lease write/release. Providers and fulfillment remain unverified.');
  } finally {
    // Do not blindly retry uncertain writes. A smoke lease expires after 30 seconds.
    if (lease) console.error('Smoke lease release not verified; allow expiry before another run.');
    await client.close();
  }
}

renderSmoke().catch(() => {
  // SDK errors can contain URLs or provider diagnostics: never print raw exceptions.
  console.error('FAIL: Render smoke incomplete; inspect protected diagnostics. No order completion is claimed.');
  process.exitCode = 1;
});
