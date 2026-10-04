import { z } from 'zod';

const groups = {
  whatsapp: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_GRAPH_VERSION'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ALLOWED_USER_IDS'],
  maps: ['GOOGLE_MAPS_API_KEY'],
  gnani: ['GNANI_API_KEY_ID', 'GNANI_BASE_URL'],
  sheets: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SHEETS_SPREADSHEET_ID'],
  gmail: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REDIRECT_URI', 'GMAIL_REFRESH_TOKEN'],
  razorpay: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'PAYMENTS_MODE'],
  audio: ['AUDIO_S3_ENDPOINT', 'AUDIO_S3_BUCKET', 'AUDIO_S3_ACCESS_KEY_ID', 'AUDIO_S3_SECRET_ACCESS_KEY', 'AUDIO_S3_REGION'],
  delhivery: ['DELHIVERY_MOCK_TOKEN']
} as const;

export type ServiceName = keyof typeof groups;
export interface ServiceState { configured: boolean; enabled: boolean; implemented: boolean; live_verified: boolean; missing: string[] }
export interface Config {
  port: number;
  production: boolean;
  publicOrigin?: string;
  allowedOrigins: string[];
  mcpKey?: string;
  adminToken?: string;
  databaseUrl?: string;
  upstreamTimeoutMs: number;
  services: Record<ServiceName, ServiceState>;
  whatsappWebhook: { appSecret?: string; verifyToken?: string; phoneNumberId?: string };
  razorpay: { keyId?: string; keySecret?: string; webhookSecret?: string };
  telegram: { token?: string; secret?: string; users: string[]; botId?: string };
  gnani: { key?: string; origin?: string };
  maps: { key?: string };
  audio: { endpoint?: string; bucket?: string; accessKey?: string; secretKey?: string; region?: string };
  coreMissing: string[];
}

// PUBLIC_INTERFACE
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  /** Validate names-only configuration; absent credentials do not simulate service readiness. */
  const present = (name: string) => Boolean(env[name]?.trim());
  const production = env.NODE_ENV === 'production';
  const port = z.coerce.number().int().min(1).max(65535).parse(env.PORT || 3000);
  const upstreamTimeoutMs = z.coerce.number().int().min(100).max(60000).parse(env.UPSTREAM_TIMEOUT_MS || 10000);
  const validateOrigin = (value: string) => {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Invalid application origin configuration');
    }
    return url.origin;
  };
  const publicOrigin = present('PUBLIC_BASE_URL') ? validateOrigin(env.PUBLIC_BASE_URL!) : undefined;
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean).map(validateOrigin);
  if (present('MCP_API_KEY') && env.MCP_API_KEY!.length < 32) throw new Error('MCP_API_KEY must have at least 32 characters');
  if (present('ADMIN_TOKEN') && (env.ADMIN_TOKEN!.length < 32 || env.ADMIN_TOKEN === env.MCP_API_KEY)) {
    throw new Error('ADMIN_TOKEN must be distinct and have at least 32 characters');
  }
  if (present('DATABASE_URL')) {
    const url = new URL(env.DATABASE_URL!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.searchParams.get('sslmode') !== 'verify-full') {
      throw new Error('DATABASE_URL must use Postgres with sslmode=verify-full');
    }
  }
  if (present('PAYMENTS_MODE') && env.PAYMENTS_MODE !== 'test') throw new Error('Only test payments are permitted');
  if (present('RAZORPAY_KEY_ID') && (!env.RAZORPAY_KEY_ID!.startsWith('rzp_test_') || env.PAYMENTS_MODE !== 'test')) {
    throw new Error('Razorpay requires test identity and test mode');
  }
  const flags = { telegram: 'TELEGRAM_ENABLED', gnani: 'GNANI_ENABLED', maps: 'GOOGLE_MAPS_ENABLED' } as const;
  for (const flag of Object.values(flags)) {
    if (present(flag) && !['true', 'false'].includes(env[flag]!)) throw new Error('Enable flags must be true or false');
  }
  const users = (env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (users.some(v => !/^[1-9]\d{0,15}$/.test(v) || !Number.isSafeInteger(Number(v)))) throw new Error('Invalid Telegram sender allowlist');
  if (present('TELEGRAM_BOT_TOKEN') && !/^[1-9]\d{0,15}:[A-Za-z0-9_-]{20,200}$/.test(env.TELEGRAM_BOT_TOKEN!)) throw new Error('Invalid Telegram token shape');
  if (present('TELEGRAM_WEBHOOK_SECRET') && (!/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET!) ||
      [env.MCP_API_KEY, env.ADMIN_TOKEN, env.TELEGRAM_BOT_TOKEN].includes(env.TELEGRAM_WEBHOOK_SECRET))) throw new Error('Invalid distinct Telegram webhook secret');
  if (present('GNANI_BASE_URL') && env.GNANI_BASE_URL !== 'https://api.vachana.ai') throw new Error('Untrusted Gnani origin');
  if (present('AUDIO_S3_ENDPOINT')) {
    const url = new URL(env.AUDIO_S3_ENDPOINT!);
    if (url.origin !== env.AUDIO_S3_ENDPOINT || url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid private storage origin');
  }
  if (present('AUDIO_S3_BUCKET') && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.AUDIO_S3_BUCKET!)) throw new Error('Invalid private storage bucket');
  const services = Object.fromEntries(Object.entries(groups).map(([name, keys]) => {
    const missing = keys.filter(key => !present(key));
    const flag = flags[name as keyof typeof flags];
    return [name, { configured: missing.length === 0, enabled: flag ? env[flag] === 'true' : missing.length === 0,
      implemented: ['telegram', 'gnani', 'maps', 'audio', 'razorpay'].includes(name), live_verified: false, missing }];
  })) as Record<ServiceName, ServiceState>;
  const coreMissing = ['MCP_API_KEY', 'ADMIN_TOKEN', 'DATABASE_URL', 'PUBLIC_BASE_URL', 'ALLOWED_ORIGINS'].filter(name => !present(name));
  return { port, production, publicOrigin, allowedOrigins, mcpKey: env.MCP_API_KEY,
    adminToken: env.ADMIN_TOKEN, databaseUrl: env.DATABASE_URL, upstreamTimeoutMs, services, coreMissing,
    whatsappWebhook: { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
    razorpay: { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET },
    telegram: { token: env.TELEGRAM_BOT_TOKEN, secret: env.TELEGRAM_WEBHOOK_SECRET, users,
      botId: env.TELEGRAM_BOT_TOKEN?.split(':')[0] },
    gnani: { key: env.GNANI_API_KEY_ID, origin: env.GNANI_BASE_URL }, maps: { key: env.GOOGLE_MAPS_API_KEY },
    audio: { endpoint: env.AUDIO_S3_ENDPOINT, bucket: env.AUDIO_S3_BUCKET, accessKey: env.AUDIO_S3_ACCESS_KEY_ID,
      secretKey: env.AUDIO_S3_SECRET_ACCESS_KEY, region: env.AUDIO_S3_REGION } };
}
