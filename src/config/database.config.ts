import { registerAs } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const databaseConfig = registerAs('database', () => {
  const env = validateEnv(process.env);

  return {
    path: env.DATABASE_PATH,
    synchronize: env.DATABASE_SYNCHRONIZE,
    logging: env.DATABASE_LOGGING,
  };
});
