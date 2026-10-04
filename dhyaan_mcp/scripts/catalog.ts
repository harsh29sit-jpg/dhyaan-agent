import { toolCatalog } from '../src/mcp/registry.js';

console.info(JSON.stringify({
  status: 'provisional',
  freeze_gates: ['OPEN-01', 'OPEN-03'],
  schema_source: 'src/mcp/schemas.ts',
  tools: toolCatalog()
}, null, 2));
