import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfig } from './app.config.js';
import { authConfig } from './auth.config.js';
import { bitrixConfig } from './bitrix.config.js';
import { databaseConfig } from './database.config.js';
import { jotformConfig } from './jotform.config.js';
import { validateEnv } from './env.validation.js';

/** Loads `.env`, validates it with Zod and exposes the namespaced configs app-wide. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [appConfig, authConfig, databaseConfig, bitrixConfig, jotformConfig],
    }),
  ],
})
export class AppConfigModule {}
