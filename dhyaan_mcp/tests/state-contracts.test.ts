import { describe, expect, it, vi } from 'vitest';
import { validateStateArguments, stateRows } from '../src/mcp/state-schemas.js';
import { dispatchTool } from '../src/mcp/registry.js';
import { loadConfig } from '../src/config.js';

describe('PRD-derived state contracts', () => {
  it('rejects unknown columns, invalid enums and immutable key updates', () => {
    expect(() => validateStateArguments('state_read', { tab: 'patients', where: { sql: 'SELECT *' } })).toThrow();
    expect(() => validateStateArguments('state_update', { tab: 'care_tasks', patch: { status: 'COMPLETE' } })).toThrow();
    expect(() => validateStateArguments('state_update', { tab: 'patients', patch: { patient_id: 'PAT-2' } })).toThrow();
    expect(() => validateStateArguments('state_update', { tab: 'patients', patch: {} })).toThrow();
    expect(() => validateStateArguments('state_update', { tab: 'care_tasks', patch: { status: 'DONE' } })).not.toThrow();
  });
  it('does not apply budget or clinical policy', () => {
    const valid = { policy_id: 'POL-1', auto_auth_limit_inr: 1500, primary_approver_id: 'MEM-1',
      backup_approver_id: 'MEM-2', approval_timeout_min: 6, reminder_after_min: 3,
      consent_payments: 'TRUE', consent_data_sharing: 'TRUE' };
    expect(stateRows.policies.parse(valid)).toEqual(valid);
    expect(stateRows.policies.safeParse({ ...valid, auto_auth_limit_inr: 1.5 }).success).toBe(false);
  });
  it('audits invalid arguments and unknown tools without logging raw data', async () => {
    const begin = vi.fn(), finish = vi.fn();
    const dependencies = { audit: { begin, finish, healthy: vi.fn() } };
    const config = loadConfig({ MCP_API_KEY: 'synthetic-offline-test-key-only-0001' });
    expect(await dispatchTool('state_read', { tab: 'patients', where: { secret_column: 'private text' } },
      config, dependencies)).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect(await dispatchTool('raw_secret_as_tool_name', {}, config, dependencies))
      .toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect(begin).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(begin.mock.calls)).not.toContain('private text');
    expect(JSON.stringify(begin.mock.calls)).not.toContain('raw_secret_as_tool_name');
  });
});
