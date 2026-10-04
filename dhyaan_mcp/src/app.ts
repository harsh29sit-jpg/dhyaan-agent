import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import type { Config } from './config.js';
import { handleMcp } from './mcp/server.js';
import type { Dependencies } from './mcp/registry.js';
import { telegramWebhook } from './routes/telegram-webhook.js';
import { razorpayWebhook } from './routes/razorpay-webhook.js';

function equalSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// PUBLIC_INTERFACE
export function createApp(config: Config, dependencies: Dependencies = {}) {
  /** Build the single HTTP service; provider webhooks refuse delivery until durable intake exists. */
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.get('/health/live', (_req, res) => res.json({ live: true }));
  app.get('/health/transport', async (_req, res) => {
    const database = dependencies.deploymentHealthy ?
      await dependencies.deploymentHealthy().catch(() => false) : false;
    const audit = dependencies.audit ? await dependencies.audit.healthy().catch(() => false) : false;
    const ready = config.coreMissing.length === 0 && database && audit &&
      Boolean(dependencies.runs && dependencies.revised);
    res.setHeader('Cache-Control', 'no-store');
    res.status(ready ? 200 : 503).json({ ready, scope: 'mcp_transport', database, audit,
      core_missing: config.coreMissing, provider_live_verified: false, fulfillment_verified: false });
  });
  app.get('/health/ready', async (_req, res) => {
    const database = dependencies.audit ? await dependencies.audit.healthy().catch(() => false) : false;
    // Bootstrap discovery is not whole-application readiness.
    res.status(503).json({ ready: false, implementation: 'offline_mechanics_live_unverified', database,
      core_missing: config.coreMissing, services: config.services, contracts: 'provisional' });
  });

  // Raw-body routes must precede JSON parsing; no acknowledgement before durable commit.
  app.use('/webhooks/telegram', telegramWebhook(config, dependencies.telegramInbox));
  app.use('/webhooks/razorpay', razorpayWebhook(config.razorpay.webhookSecret, dependencies.paymentEvents));

  let windowStart = Date.now(), count = 0;
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!config.mcpKey) { res.status(503).json({ error: 'MCP authentication is not configured' }); return; }
    if (!equalSecret(req.get('authorization') || '', `Bearer ${config.mcpKey}`)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const origin = req.get('origin');
    if ((origin && !config.allowedOrigins.includes(origin)) ||
        !config.publicOrigin || req.get('host') !== new URL(config.publicOrigin).host) {
      res.status(403).json({ error: 'Origin or host not allowed' }); return;
    }
    // Single-container bounded limiter. No per-IP map susceptible to unbounded allocation.
    const now = Date.now();
    if (now - windowStart >= 60000) { count = 0; windowStart = now; }
    if (++count > 100) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Rate limited' }); return; }
    next();
  });
  app.post('/mcp', express.json({ limit: '256kb', strict: true }), (req, res) => handleMcp(req, res, config, dependencies));
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Stateless transport supports POST only' });
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status = error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : 400;
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? 'Body too large' : 'Invalid request' });
  };
  app.use(errors);
  return app;
}
