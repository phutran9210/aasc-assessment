import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { validateTiktokEnv } from '../../config/tiktok-app/env.validation.js';
import { AggregateLeaseRepository } from '../../core/queue/repositories/aggregate-lease.repository.js';
import { OutboxRepository } from '../../core/queue/repositories/outbox.repository.js';
import { OperationRunnerService } from '../../core/queue/services/operation-runner.service.js';
import { RecoverySweeperService } from '../../core/queue/services/recovery-sweeper.service.js';
import { OutboxDispatcherService } from '../../core/queue/services/outbox-dispatcher.service.js';
import { WorkerLifecycleService } from '../../core/queue/services/worker-lifecycle.service.js';
import { TiktokDatabaseModule } from './database/database.module.js';
import { QueueModule } from '../../core/queue/queue.module.js';
import { createTiktokWorkerHandlers } from './worker-handlers.js';
import type { OperationHandlerRegistry } from '../../core/queue/types/worker.types.js';
import { REDIS_CONNECTION_FACTORY } from '../../config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '../../core/queue/redis-connection.js';

export const TIKTOK_OPERATION_HANDLERS = Symbol('TIKTOK_OPERATION_HANDLERS');

@Module({
  imports: [TiktokDatabaseModule, QueueModule],
  providers: [
    { provide: TIKTOK_OPERATION_HANDLERS, useFactory: createTiktokWorkerHandlers },
    {
      provide: OperationRunnerService,
      inject: [
        TIKTOK_OPERATION_HANDLERS,
        AggregateLeaseRepository,
        OutboxRepository,
        getDataSourceToken('tiktok'),
      ],
      useFactory: (
        handlers: OperationHandlerRegistry,
        leases: AggregateLeaseRepository,
        outbox: OutboxRepository,
        dataSource: DataSource,
      ) => new OperationRunnerService(dataSource, handlers, leases, outbox),
    },
    {
      provide: RecoverySweeperService,
      inject: [getDataSourceToken('tiktok'), OutboxRepository],
      useFactory: (dataSource: DataSource, outbox: OutboxRepository) =>
        new RecoverySweeperService(dataSource, outbox),
    },
    {
      provide: WorkerLifecycleService,
      inject: [
        REDIS_CONNECTION_FACTORY,
        OperationRunnerService,
        OutboxDispatcherService,
        RecoverySweeperService,
      ],
      useFactory: (
        redis: RedisConnectionFactory,
        runner: OperationRunnerService,
        dispatcher: OutboxDispatcherService,
        recovery: RecoverySweeperService,
      ) =>
        new WorkerLifecycleService(
          redis,
          runner,
          validateTiktokEnv(process.env).queuePrefix,
          dispatcher,
          recovery,
        ),
    },
  ],
})
export class TiktokWorkerModule {}
