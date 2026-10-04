import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import type { Config } from '../config.js';
import { dispatchTool, toolCatalog, type Dependencies } from './registry.js';

// PUBLIC_INTERFACE
export async function handleMcp(req: Request, res: Response, config: Config, dependencies: Dependencies): Promise<void> {
  /** Handle authenticated POST JSON-RPC with a stateless SDK transport; caller owns HTTP authorization. */
  const server = new Server({ name: 'dhyaan_mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolCatalog() }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const result = await dispatchTool(request.params.name, request.params.arguments, config, dependencies);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      isError: Boolean(result && typeof result === 'object' && 'ok' in result && !result.ok) };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= Promise.all([transport.close(), server.close()]).then(() => undefined);
  res.on('close', () => { void close().catch(() => undefined); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    await close().catch(() => undefined);
  }
}
