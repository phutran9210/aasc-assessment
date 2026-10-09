import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { IntegrationMetrics, METRICS_RECORDER } from '@common/logging/integration-logger.js';
import type { MetricsRecorder } from '@common/logging/integration-logger.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { TiktokRedisModule } from '@core/queue/redis.module.js';
import { WorkerHeartbeatService } from '@core/queue/services/worker-heartbeat.service.js';
import { TiktokDatabaseModule } from '../database/database.module.js';
import { TiktokHealthController } from './health.controller.js';
import { TiktokHealthService } from './health.service.js';

@Module({
  imports: [TiktokDatabaseModule, TiktokRedisModule],
  controllers: [TiktokHealthController],
  providers: [
    { provide: METRICS_RECORDER, useFactory: () => new IntegrationMetrics() },
    {
      provide: TiktokHealthService,
      inject: [getDataSourceToken('tiktok'), REDIS_CONNECTION_FACTORY, METRICS_RECORDER],
      useFactory: (
        dataSource: DataSource,
        redis: RedisConnectionFactory,
        metrics: MetricsRecorder,
      ) => {
        const config = validateTiktokEnv(process.env);
        return new TiktokHealthService(
          dataSource,
          redis,
          // The API only reads beats; it never starts the heartbeat timer of a worker.
          new WorkerHeartbeatService(redis, 'api-reader'),
          metrics,
          {
            tiktokMode: config.tiktokMode,
            bitrixMode: config.bitrixMode,
            workerRequired: config.workerEnabled,
          },
        );
      },
    },
  ],
  exports: [TiktokHealthService, METRICS_RECORDER],
})
export class TiktokHealthModule {}
