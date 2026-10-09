import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { TiktokRedisModule } from '@core/queue/redis.module.js';
import { IntegrationAuthModule } from '@modules/integration-auth/index.js';
import { AnalyticsController } from './controllers/analytics.controller.js';
import { AnalyticsRevisionRepository } from './repositories/analytics-revision.repository.js';
import { AnalyticsRepository } from './repositories/analytics.repository.js';
import { CampaignCostRepository } from './repositories/campaign-cost.repository.js';
import { AnalyticsCache, RedisAnalyticsCacheStore } from './services/analytics-cache.service.js';
import { AnalyticsService } from './services/analytics.service.js';
import { CampaignCostService } from './services/campaign-cost.service.js';

@Module({
  imports: [TiktokDatabaseModule, TiktokRedisModule, IntegrationAuthModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsRevisionRepository,
    CampaignCostRepository,
    {
      provide: CampaignCostService,
      inject: [CampaignCostRepository, AnalyticsRevisionRepository],
      useFactory: (costs: CampaignCostRepository, revisions: AnalyticsRevisionRepository) =>
        new CampaignCostService(costs, revisions),
    },
    {
      provide: AnalyticsRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new AnalyticsRepository(dataSource),
    },
    {
      provide: AnalyticsCache,
      inject: [REDIS_CONNECTION_FACTORY],
      useFactory: (redis: RedisConnectionFactory) =>
        new AnalyticsCache(new RedisAnalyticsCacheStore(redis)),
    },
    {
      provide: AnalyticsService,
      inject: [AnalyticsRepository, CampaignCostService, AnalyticsCache],
      useFactory: (
        repository: AnalyticsRepository,
        costs: CampaignCostService,
        cache: AnalyticsCache,
      ) => {
        const config = validateTiktokEnv(process.env);
        return new AnalyticsService(repository, costs, cache, {
          advertiserId: config.advertiserId,
          portalKey: config.portalKey,
          tiktokMode: config.tiktokMode,
          bitrixMode: config.bitrixMode,
          reportTimezone: config.reportTimezone,
        });
      },
    },
  ],
  exports: [
    AnalyticsRevisionRepository,
    AnalyticsRepository,
    CampaignCostService,
    AnalyticsService,
  ],
})
export class IntegrationAnalyticsModule {}
