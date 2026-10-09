import { z } from 'zod';

const schema = z
  .object({
    TIKTOK_APP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    TIKTOK_DATABASE_URL: z.url().startsWith('postgres'),
    TIKTOK_DATABASE_SCHEMA: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/)
      .optional(),
    TIKTOK_REDIS_URL: z.url().startsWith('redis'),
    TIKTOK_JWT_SECRET: z.string().min(32),
    TIKTOK_JWT_ISSUER: z.string().trim().min(1),
    TIKTOK_JWT_AUDIENCE: z.string().trim().min(1),
    TIKTOK_JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    TIKTOK_MODE: z.enum(['mock', 'business-api']).default('mock'),
    BITRIX_INTEGRATION_MODE: z.enum(['mock', 'real']).default('mock'),
    TIKTOK_ADVERTISER_ID: z.string().trim().min(1),
    TIKTOK_WEBHOOK_SECRET: z.string().min(16),
    TIKTOK_EVENT_SOURCE_ID: z.string().trim().min(1).optional(),
    BITRIX_PORTAL_KEY: z.string().trim().min(1).default('mock-portal'),
    BITRIX_MOCK_EVENT_SECRET: z.string().min(16),
    BITRIX24_OUTGOING_TOKEN: z.string().trim().min(16).optional(),
    BITRIX24_WEBHOOK_URL: z.url().optional(),
    DEFAULT_PHONE_REGION: z.string().length(2).default('VN'),
    REPORT_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
    INTEGRATION_QUEUE_PREFIX: z.string().trim().min(1).default('aasc-tiktok'),
    INTEGRATION_WORKER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    INTEGRATION_SCHEDULER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    INTEGRATION_ARTIFACT_DIR: z.string().trim().min(1).default('data/tiktok-artifacts'),
    CORS_ORIGINS: z.string().default('*'),
    TIKTOK_TRUSTED_PROXIES: z.string().default(''),
    TIKTOK_INGRESS_IP_LIMIT: z.coerce.number().int().min(1).max(100_000).default(600),
    TIKTOK_WEBHOOK_ADVERTISER_LIMIT: z.coerce.number().int().min(1).max(100_000).default(120),
    TIKTOK_SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  })
  .superRefine((env, context) => {
    if (
      env.BITRIX_INTEGRATION_MODE === 'real' &&
      env.BITRIX24_WEBHOOK_URL &&
      !env.BITRIX24_OUTGOING_TOKEN
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BITRIX24_OUTGOING_TOKEN'],
        message: 'is required when real Bitrix callbacks use webhook mode',
      });
    }
  });

export type TiktokAppConfig = {
  port: number;
  databaseUrl: string;
  databaseSchema?: string;
  redisUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtTtlSeconds: number;
  tiktokMode: 'mock' | 'business-api';
  bitrixMode: 'mock' | 'real';
  advertiserId: string;
  webhookSecret: string;
  eventSourceId?: string;
  portalKey: string;
  bitrixMockEventSecret: string;
  bitrixOutgoingEventToken?: string;
  bitrixWebhookUrl?: string;
  defaultPhoneRegion: string;
  reportTimezone: string;
  queuePrefix: string;
  workerEnabled: boolean;
  schedulerEnabled: boolean;
  artifactDir: string;
  /** Serve the OpenAPI UI at /docs; off by default in production. */
  swaggerEnabled: boolean;
  /** Requests per minute per client address on unauthenticated endpoints. */
  ingressIpLimit: number;
  /** Verified TikTok webhooks per minute per advertiser. */
  webhookAdvertiserLimit: number;
  /** Addresses of reverse proxies whose X-Forwarded-For header may be believed. */
  trustedProxies: string[];
  corsOrigins: string[] | '*';
};

export function validateTiktokEnv(raw: Record<string, unknown>): TiktokAppConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`TikTok environment is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  const env = parsed.data;
  return {
    port: env.TIKTOK_APP_PORT,
    databaseUrl: env.TIKTOK_DATABASE_URL,
    databaseSchema: env.TIKTOK_DATABASE_SCHEMA,
    redisUrl: env.TIKTOK_REDIS_URL,
    jwtSecret: env.TIKTOK_JWT_SECRET,
    jwtIssuer: env.TIKTOK_JWT_ISSUER,
    jwtAudience: env.TIKTOK_JWT_AUDIENCE,
    jwtTtlSeconds: env.TIKTOK_JWT_TTL_SECONDS,
    tiktokMode: env.TIKTOK_MODE,
    bitrixMode: env.BITRIX_INTEGRATION_MODE,
    advertiserId: env.TIKTOK_ADVERTISER_ID,
    webhookSecret: env.TIKTOK_WEBHOOK_SECRET,
    eventSourceId: env.TIKTOK_EVENT_SOURCE_ID,
    portalKey: env.BITRIX_PORTAL_KEY,
    bitrixMockEventSecret: env.BITRIX_MOCK_EVENT_SECRET,
    bitrixOutgoingEventToken: env.BITRIX24_OUTGOING_TOKEN,
    bitrixWebhookUrl: env.BITRIX24_WEBHOOK_URL,
    defaultPhoneRegion: env.DEFAULT_PHONE_REGION,
    reportTimezone: env.REPORT_TIMEZONE,
    queuePrefix: env.INTEGRATION_QUEUE_PREFIX,
    workerEnabled: env.INTEGRATION_WORKER_ENABLED,
    schedulerEnabled: env.INTEGRATION_SCHEDULER_ENABLED,
    artifactDir: env.INTEGRATION_ARTIFACT_DIR,
    swaggerEnabled: env.TIKTOK_SWAGGER_ENABLED
      ? env.TIKTOK_SWAGGER_ENABLED === 'true'
      : process.env.NODE_ENV !== 'production',
    ingressIpLimit: env.TIKTOK_INGRESS_IP_LIMIT,
    webhookAdvertiserLimit: env.TIKTOK_WEBHOOK_ADVERTISER_LIMIT,
    trustedProxies: env.TIKTOK_TRUSTED_PROXIES.split(',')
      .map((address) => address.trim())
      .filter(Boolean),
    corsOrigins:
      env.CORS_ORIGINS === '*'
        ? '*'
        : env.CORS_ORIGINS.split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
  };
}
