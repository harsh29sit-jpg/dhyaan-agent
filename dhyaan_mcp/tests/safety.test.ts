import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import { dispatchTool } from '../src/mcp/registry.js';
import { executeOnce } from '../src/lib/idempotency.js';
import { argumentDigest } from '../src/lib/digest.js';
import { postgresRuns } from '../src/tools/run.js';

const config = loadConfig({ MCP_API_KEY: 'synthetic-offline-test-key-only-0001' });

describe('durable dispatch boundaries', () => {
  it('does not dispatch without audit or after failed durable audit insert', async () => {
    const acquire = vi.fn();
    const runs = { acquire, release: vi.fn() };
    expect(await dispatchTool('run_acquire', { run_id: 'RUN-1' }, config, { runs })).toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
    expect(await dispatchTool('run_acquire', { run_id: 'RUN-1' }, config, { runs, audit: {
      begin: vi.fn().mockRejectedValue(new Error('internal-secret')),
      finish: vi.fn(), healthy: vi.fn()
    } })).toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
    expect(acquire).not.toHaveBeenCalled();
  });
  it('reports uncertainty if audit completion fails after dispatch', async () => {
    const result = await dispatchTool('run_acquire', { run_id: 'RUN-1' }, config, {
      audit: { begin: vi.fn(), finish: vi.fn().mockRejectedValue(new Error()), healthy: vi.fn() },
      runs: { acquire: vi.fn().mockResolvedValue({ lease_id: 'synthetic' }), release: vi.fn() }
    });
    expect(result).toMatchObject({ error: { code: 'OUTCOME_UNKNOWN', retryable: false } });
  });
  it('keeps dispatched failure uncertain, with no automatic retry', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const dispatch = vi.fn().mockRejectedValue(new Error('private provider body'));
    await expect(executeOnce({ query } as unknown as pg.Pool, { tool: 'send', key: 'one', args: {} }, dispatch))
      .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[2]![0]).toContain("status='OUTCOME_UNKNOWN'");
  });
  it('replays success but refuses ambiguous reservations and new keys for one logical payment', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ operation_key: 'one', args_digest: argumentDigest({}), status: 'SUCCEEDED', result_json: { id: 'pay-1' } }] });
    const dispatch = vi.fn();
    expect(await executeOnce({ query } as unknown as pg.Pool, { tool: 'pay', key: 'one', args: {} }, dispatch))
      .toEqual({ data: { id: 'pay-1' }, replayed: true });
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({
      rows: [{ operation_key: 'one', args_digest: argumentDigest({}), status: 'DISPATCHED' }] });
    await expect(executeOnce({ query } as unknown as pg.Pool, { tool: 'pay', key: 'two', logicalKey: 'JRN-1:TSK-1', args: {} }, dispatch))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({
      rows: [{ operation_key: 'one', args_digest: argumentDigest({}), status: 'RESERVED' }] });
    await expect(executeOnce({ query } as unknown as pg.Pool, { tool: 'pay', key: 'one', args: {} }, dispatch))
      .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('requires active matching run ownership for renewal and release', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const runs = postgresRuns({ query } as unknown as pg.Pool);
    await expect(runs.acquire('RUN-1', 'owner', 300, '00000000-0000-4000-8000-000000000001'))
      .rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
    await expect(runs.release('RUN-1', 'wrong', '00000000-0000-4000-8000-000000000001'))
      .rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
    expect(query.mock.calls[0]![0]).toContain('expires_at>now()');
    expect(query.mock.calls[0]![0]).toContain('owner=$2');
    await expect(runs.acquire('RUN-2', 'owner', 300)).rejects.toMatchObject({ code: 'RUN_BUSY' });
  });
});
