import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { validateTiktokEnv } from './env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.TIKTOK_APP_ENV_FILE ?? '.env.tiktok',
      validate: validateTiktokEnv,
    }),
  ],
})
export class TiktokConfigModule {}
