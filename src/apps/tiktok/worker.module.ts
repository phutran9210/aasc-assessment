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
import { LeadIngestService } from '../../modules/crm-integration/services/lead-ingest.service.js';
import { LeadRepository } from '../../modules/crm-integration/repositories/lead.repository.js';
import { LeadIdentityRepository } from '../../modules/crm-integration/repositories/lead-identity.repository.js';
import { SubmissionRepository } from '../../modules/crm-integration/repositories/submission.repository.js';
import { OperationRepository } from '../../core/queue/repositories/operation.repository.js';
import { WebhookEventRepository } from '../../core/queue/repositories/webhook-event.repository.js';
import { TiktokIngestHandler } from '../../modules/crm-integration/workers/tiktok-ingest.handler.js';

export const TIKTOK_OPERATION_HANDLERS = Symbol('TIKTOK_OPERATION_HANDLERS');

@Module({
  imports: [TiktokDatabaseModule, QueueModule],
  providers: [
    LeadRepository,
    LeadIdentityRepository,
    SubmissionRepository,
    OperationRepository,
    WebhookEventRepository,
    {
      provide: LeadIngestService,
      inject: [
        getDataSourceToken('tiktok'),
        LeadRepository,
        LeadIdentityRepository,
        SubmissionRepository,
        OperationRepository,
        OutboxRepository,
      ],
      useFactory: (
        dataSource: DataSource,
        leads: LeadRepository,
        identities: LeadIdentityRepository,
        submissions: SubmissionRepository,
        operations: OperationRepository,
        outbox: OutboxRepository,
      ) => {
        const config = validateTiktokEnv(process.env);
        return new LeadIngestService(
          dataSource,
          leads,
          identities,
          submissions,
          operations,
          outbox,
          config.portalKey,
          config.defaultPhoneRegion,
        );
      },
    },
    {
      provide: TiktokIngestHandler,
      inject: [getDataSourceToken('tiktok'), LeadIngestService],
      useFactory: (dataSource: DataSource, ingest: LeadIngestService) =>
        new TiktokIngestHandler(dataSource, ingest),
    },
    {
      provide: TIKTOK_OPERATION_HANDLERS,
      inject: [TiktokIngestHandler],
      useFactory: createTiktokWorkerHandlers,
    },
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
