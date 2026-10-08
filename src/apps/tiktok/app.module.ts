import { Module } from '@nestjs/common';

import { TiktokConfigModule } from '../../config/tiktok-app/config.module.js';
import { TiktokDatabaseModule } from './database/database.module.js';
import { TiktokHealthModule } from './health/health.module.js';
import { TiktokRedisModule } from '../../core/queue/redis.module.js';
import { IntegrationAuthModule } from '../../modules/integration-auth/integration-auth.module.js';

@Module({
  imports: [
    TiktokConfigModule,
    TiktokDatabaseModule,
    TiktokRedisModule,
    IntegrationAuthModule,
    TiktokHealthModule,
  ],
})
export class TiktokAppModule {}
