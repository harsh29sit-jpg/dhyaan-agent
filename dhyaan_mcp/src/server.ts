import pino from 'pino';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { postgresAudit } from './lib/audit.js';
import { postgresRuns } from './tools/run.js';
import { createApp } from './app.js';
import { postgresTelegramInbox } from './tools/telegram.js';
import { revisedMechanics } from './tools/revised.js';
import { postgresPaymentEvents } from './routes/razorpay-webhook.js';
import { razorpayReads } from './adapters/razorpay.js';
import { deploymentDatabaseHealthy } from './db/readiness.js';

const logger = pino();
try {
  const config = loadConfig();
  const pool = createPool(config);
  pool?.on('error', () => logger.error({ code: 'DATABASE_CONNECTION_ERROR' }, 'Database connection unavailable'));
  const app = createApp(config, { audit: pool ? postgresAudit(pool) : undefined,
    deploymentHealthy: pool ? () => deploymentDatabaseHealthy(pool) : undefined,
    runs: pool ? postgresRuns(pool) : undefined,
    telegramInbox: pool && config.services.telegram.enabled && config.services.telegram.configured ?
      postgresTelegramInbox(pool, config.telegram.botId!) : undefined,
    revised: pool ? revisedMechanics(pool, config) : undefined,
    paymentEvents: pool ? postgresPaymentEvents(pool) : undefined,
    paymentReads: pool && config.services.razorpay.configured ? razorpayReads(config, pool) : undefined });
  const server = app.listen(config.port, () => logger.info({
    port: config.port, core_missing: config.coreMissing, implementation: 'offline_mechanics_live_unverified'
  }, 'Dhyaan started; live acceptance is not established'));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      (pool?.end() ?? Promise.resolve()).finally(() => { clearTimeout(deadline); });
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  logger.error({ code: 'INVALID_CONFIGURATION' }, 'Startup configuration rejected');
  process.exitCode = 1;
}
