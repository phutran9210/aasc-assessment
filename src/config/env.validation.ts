import { validateCronExpression } from 'cron';
import { z } from 'zod';

export const NODE_ENVS = ['development', 'production', 'test'] as const;

/** Lets the app start right after cloning. Refused when NODE_ENV=production. */
export const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me';

export const GOOGLE_AUTH_MODES = ['service_account', 'oauth'] as const;
export const LEAD_SYNC_DIRECTIONS = ['sheet-to-bitrix', 'two-way'] as const;
/** Countries the phone normalizer knows the calling code of. */
export const LEAD_SYNC_COUNTRIES = ['VN', 'US', 'SG'] as const;
export type LeadSyncCountry = (typeof LEAD_SYNC_COUNTRIES)[number];

/** Parses the `true`/`false` strings used in `.env` files into a real boolean. */
const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

/** Treats a blank `.env` value as "not set" before validating it with `schema`. */
const blankAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

/** A service account key file, base64-encoded: must decode to JSON with the two fields we use. */
function isServiceAccountKeyBase64(value: string): boolean {
  try {
    const key = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    return typeof key.client_email === 'string' && typeof key.private_key === 'string';
  } catch {
    return false;
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Single source of truth for environment variables: validation, defaults and types.
 * Add new variables here — never read `process.env` anywhere else.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // `*` allows every origin; otherwise a comma-separated list of allowed origins.
    CORS_ORIGINS: z
      .string()
      .trim()
      .min(1)
      .default('*')
      .transform((value): string | string[] =>
        value === '*'
          ? value
          : value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean),
      ),
    SWAGGER_ENABLED: booleanString('true'),

    DATABASE_PATH: z.string().trim().min(1).default('data/app.sqlite'),
    DATABASE_SYNCHRONIZE: booleanString('true'),
    DATABASE_LOGGING: booleanString('false'),

    JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(86_400),
    // bcrypt cost factor: each +1 doubles the hashing time.
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

    BITRIX24_CLIENT_ID: optionalText,
    BITRIX24_CLIENT_SECRET: optionalText,
    BITRIX24_DOMAIN: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .trim()
        .regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, {
          message: 'phải là hostname Bitrix24 hợp lệ',
        })
        .optional(),
    ),
    BITRIX24_REQUISITE_PRESET_ID: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),

    JOTFORM_API_KEY: optionalText,
    // The digits at the end of the form URL: https://form.jotform.com/252771234567890
    JOTFORM_FORM_ID: blankAsUnset(
      z
        .string()
        .trim()
        .regex(/^\d+$/, { message: 'phải là dãy số trong URL của biểu mẫu' })
        .optional(),
    ),
    // Shared secret Jotform sends back as `?secret=` on every webhook call.
    JOTFORM_WEBHOOK_SECRET: blankAsUnset(z.string().min(16).optional()),
    // Use https://eu-api.jotform.com for accounts in the EU data region.
    JOTFORM_API_BASE_URL: blankAsUnset(z.url().default('https://api.jotform.com')),

    GOOGLE_AUTH_MODE: blankAsUnset(z.enum(GOOGLE_AUTH_MODES).default('service_account')),
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: optionalText,
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: blankAsUnset(
      z
        .string()
        .trim()
        .refine(isServiceAccountKeyBase64, {
          message: 'phải là nội dung file khóa JSON của service account, mã hóa base64',
        })
        .optional(),
    ),
    GOOGLE_OAUTH_CLIENT_ID: optionalText,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalText,
    GOOGLE_OAUTH_REDIRECT_URI: blankAsUnset(z.url().optional()),
    // Where the OAuth refresh token is kept after the consent; a secret, like the key file.
    GOOGLE_OAUTH_TOKEN_FILE: blankAsUnset(
      z.string().trim().min(1).default('secrets/google-oauth-token.json'),
    ),
    // The part of the Sheet URL between `/d/` and `/edit`.
    GOOGLE_SHEET_ID: blankAsUnset(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{20,}$/, { message: 'phải là chuỗi giữa /d/ và /edit trong URL' })
        .optional(),
    ),
    GOOGLE_SHEET_NAME: blankAsUnset(z.string().trim().min(1).default('Leads')),

    // The URL itself is a secret: it carries the webhook code.
    BITRIX24_WEBHOOK_URL: blankAsUnset(
      z
        .string()
        .trim()
        .regex(/^https:\/\/[^/\s]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/, {
          message: 'phải có dạng https://<portal>/rest/<user id>/<mã webhook>/',
        })
        .optional(),
    ),

    LEAD_SYNC_MAPPING_PATH: blankAsUnset(z.string().trim().min(1).default('config/mapping.json')),
    // Empty disables the schedule.
    LEAD_SYNC_CRON: blankAsUnset(
      z
        .string()
        .trim()
        .refine((value) => validateCronExpression(value).valid, {
          message: 'phải là biểu thức cron hợp lệ, ví dụ */15 * * * *',
        })
        .optional(),
    ),
    LEAD_SYNC_TIMEZONE: blankAsUnset(
      z
        .string()
        .trim()
        .refine(isTimeZone, { message: 'phải là múi giờ IANA, ví dụ Asia/Ho_Chi_Minh' })
        .default('Asia/Ho_Chi_Minh'),
    ),
    LEAD_SYNC_DIRECTION: blankAsUnset(z.enum(LEAD_SYNC_DIRECTIONS).default('sheet-to-bitrix')),
    LEAD_SYNC_DEFAULT_COUNTRY: blankAsUnset(z.enum(LEAD_SYNC_COUNTRIES).default('VN')),
    LEAD_SYNC_MAX_RETRIES: blankAsUnset(z.coerce.number().int().min(0).max(10).default(4)),
    LEAD_SYNC_LOG_RETENTION_DAYS: blankAsUnset(
      z.coerce.number().int().min(1).max(3650).default(30),
    ),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && env.JWT_SECRET === DEV_JWT_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'phải đặt giá trị riêng khi NODE_ENV=production',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables and fails fast with a readable message.
 * Used both as `ConfigModule`'s `validate` hook and by every `registerAs()` factory.
 */
export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Biến môi trường không hợp lệ:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
