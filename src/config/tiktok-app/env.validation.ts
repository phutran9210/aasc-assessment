import { z } from 'zod';

const schema = z.object({
  TIKTOK_APP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TIKTOK_DATABASE_URL: z.url().startsWith('postgres'),
  TIKTOK_REDIS_URL: z.url().startsWith('redis'),
  TIKTOK_JWT_SECRET: z.string().min(32),
  TIKTOK_JWT_ISSUER: z.string().trim().min(1),
  TIKTOK_JWT_AUDIENCE: z.string().trim().min(1),
  TIKTOK_MODE: z.enum(['mock', 'business-api']).default('mock'),
  BITRIX_INTEGRATION_MODE: z.enum(['mock', 'real']).default('mock'),
  TIKTOK_ADVERTISER_ID: z.string().trim().min(1),
  TIKTOK_WEBHOOK_SECRET: z.string().min(16),
  TIKTOK_EVENT_SOURCE_ID: z.string().trim().min(1).optional(),
  BITRIX_PORTAL_KEY: z.string().trim().min(1).default('mock-portal'),
  BITRIX24_WEBHOOK_URL: z.url().optional(),
  DEFAULT_PHONE_REGION: z.string().length(2).default('VN'),
  REPORT_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  INTEGRATION_QUEUE_PREFIX: z.string().trim().min(1).default('aasc-tiktok'),
  INTEGRATION_WORKER_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  INTEGRATION_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  INTEGRATION_ARTIFACT_DIR: z.string().trim().min(1).default('data/tiktok-artifacts'),
  CORS_ORIGINS: z.string().default('*'),
});

export type TiktokAppConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  tiktokMode: 'mock' | 'business-api';
  bitrixMode: 'mock' | 'real';
  advertiserId: string;
  webhookSecret: string;
  eventSourceId?: string;
  portalKey: string;
  bitrixWebhookUrl?: string;
  defaultPhoneRegion: string;
  reportTimezone: string;
  queuePrefix: string;
  workerEnabled: boolean;
  schedulerEnabled: boolean;
  artifactDir: string;
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
    redisUrl: env.TIKTOK_REDIS_URL,
    jwtSecret: env.TIKTOK_JWT_SECRET,
    jwtIssuer: env.TIKTOK_JWT_ISSUER,
    jwtAudience: env.TIKTOK_JWT_AUDIENCE,
    tiktokMode: env.TIKTOK_MODE,
    bitrixMode: env.BITRIX_INTEGRATION_MODE,
    advertiserId: env.TIKTOK_ADVERTISER_ID,
    webhookSecret: env.TIKTOK_WEBHOOK_SECRET,
    eventSourceId: env.TIKTOK_EVENT_SOURCE_ID,
    portalKey: env.BITRIX_PORTAL_KEY,
    bitrixWebhookUrl: env.BITRIX24_WEBHOOK_URL,
    defaultPhoneRegion: env.DEFAULT_PHONE_REGION,
    reportTimezone: env.REPORT_TIMEZONE,
    queuePrefix: env.INTEGRATION_QUEUE_PREFIX,
    workerEnabled: env.INTEGRATION_WORKER_ENABLED,
    schedulerEnabled: env.INTEGRATION_SCHEDULER_ENABLED,
    artifactDir: env.INTEGRATION_ARTIFACT_DIR,
    corsOrigins:
      env.CORS_ORIGINS === '*'
        ? '*'
        : env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}
