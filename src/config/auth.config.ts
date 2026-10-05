import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const authConfig = registerAs('auth', () => {
  const env = validateEnv(process.env);

  return {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresInSeconds: env.JWT_EXPIRES_IN_SECONDS,
    bcryptRounds: env.BCRYPT_ROUNDS,
  };
});

export type AuthConfig = ConfigType<typeof authConfig>;
