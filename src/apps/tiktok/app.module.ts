import { Module } from '@nestjs/common';

import { TiktokConfigModule } from '@config/tiktok-app/config.module.js';
import { TiktokDatabaseModule } from './database/database.module.js';
import { TiktokHealthModule } from './health/health.module.js';
import { TiktokRedisModule } from '@core/queue/redis.module.js';
import { IntegrationAuthModule } from '@modules/integration-auth/index.js';
import { TiktokModule } from '@modules/tiktok/tiktok.module.js';
import { IntegrationAnalyticsModule } from '@modules/integration-analytics/index.js';
import { IntegrationReportsModule } from '@modules/integration-reports/index.js';

@Module({
  imports: [
    TiktokConfigModule,
    TiktokDatabaseModule,
    TiktokRedisModule,
    IntegrationAuthModule,
    TiktokHealthModule,
    TiktokModule,
    IntegrationAnalyticsModule,
    IntegrationReportsModule,
  ],
})
export class TiktokAppModule {}
