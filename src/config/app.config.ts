import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS,
    swaggerEnabled: env.SWAGGER_ENABLED,
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
