import { z } from 'zod';

export const NODE_ENVS = ['development', 'production', 'test'] as const;

/** Lets the app start right after cloning. Refused when NODE_ENV=production. */
export const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me';

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
