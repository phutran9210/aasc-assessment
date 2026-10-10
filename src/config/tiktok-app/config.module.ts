import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { validateTiktokEnv } from './env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The one configuration file of the repository; tests point this elsewhere.
      envFilePath: process.env.TIKTOK_APP_ENV_FILE ?? '.env',
      validate: validateTiktokEnv,
    }),
  ],
})
export class TiktokConfigModule {}
