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
import { LeadSyncService } from '../../modules/crm-integration/services/lead-sync.service.js';
import { RemoteReconciliationService } from '../../modules/crm-integration/services/remote-reconciliation.service.js';
import { TimelineService } from '../../modules/crm-integration/services/timeline.service.js';
import { LeadSyncHandler } from '../../modules/crm-integration/workers/lead-sync.handler.js';
import { TimelineHandler } from '../../modules/crm-integration/workers/timeline.handler.js';
import { CRM_GATEWAY } from '../../modules/crm-integration/ports/crm-gateway.port.js';
import type { CrmGateway } from '../../modules/crm-integration/ports/crm-gateway.port.js';
import { BitrixCrmGateway } from '../../modules/crm-integration/gateways/bitrix-crm.gateway.js';
import { BitrixAdapterModule } from '../../modules/crm-integration/bitrix-adapter.module.js';
import type { BitrixConfig } from '../../config/index.js';

export const TIKTOK_OPERATION_HANDLERS = Symbol('TIKTOK_OPERATION_HANDLERS');

@Module({
  imports: [TiktokDatabaseModule, QueueModule, workerBitrixAdapter()],
  providers: [
    LeadRepository,
    LeadIdentityRepository,
    SubmissionRepository,
    OperationRepository,
    WebhookEventRepository,
    RemoteReconciliationService,
    BitrixCrmGateway,
    { provide: CRM_GATEWAY, useExisting: BitrixCrmGateway },
    {
      provide: TimelineService,
      inject: [
        getDataSourceToken('tiktok'),
        CRM_GATEWAY,
        RemoteReconciliationService,
        OperationRepository,
        OutboxRepository,
      ],
      useFactory: (
        dataSource: DataSource,
        gateway: CrmGateway,
        reconciliation: RemoteReconciliationService,
        operations: OperationRepository,
        outbox: OutboxRepository,
      ) => new TimelineService(dataSource, gateway, reconciliation, operations, outbox),
    },
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
      provide: LeadSyncService,
      inject: [
        getDataSourceToken('tiktok'),
        CRM_GATEWAY,
        RemoteReconciliationService,
        OperationRepository,
        OutboxRepository,
        TimelineService,
      ],
      useFactory: (
        dataSource: DataSource,
        gateway: CrmGateway,
        reconciliation: RemoteReconciliationService,
        operations: OperationRepository,
        outbox: OutboxRepository,
        timeline: TimelineService,
      ) =>
        new LeadSyncService(
          dataSource,
          gateway,
          reconciliation,
          operations,
          outbox,
          timeline,
          validateTiktokEnv(process.env).defaultPhoneRegion,
        ),
    },
    {
      provide: LeadSyncHandler,
      inject: [getDataSourceToken('tiktok'), LeadSyncService],
      useFactory: (dataSource: DataSource, sync: LeadSyncService) =>
        new LeadSyncHandler(dataSource, sync),
    },
    {
      provide: TimelineHandler,
      inject: [getDataSourceToken('tiktok'), TimelineService],
      useFactory: (dataSource: DataSource, timeline: TimelineService) =>
        new TimelineHandler(dataSource, timeline),
    },
    {
      provide: TIKTOK_OPERATION_HANDLERS,
      inject: [TiktokIngestHandler, LeadSyncHandler, TimelineHandler],
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

function workerBitrixAdapter() {
  const portalKey = process.env.BITRIX_PORTAL_KEY ?? 'mock-portal';
  const requisitePresetId = Number(process.env.BITRIX24_REQUISITE_PRESET_ID ?? 0);
  const bitrix: BitrixConfig = {
    clientId: process.env.BITRIX24_CLIENT_ID ?? '',
    clientSecret: process.env.BITRIX24_CLIENT_SECRET ?? '',
    portalDomain: process.env.BITRIX24_DOMAIN ?? '',
    requisitePresetId:
      Number.isSafeInteger(requisitePresetId) && requisitePresetId >= 0 ? requisitePresetId : 0,
    webhookUrl: process.env.BITRIX24_WEBHOOK_URL,
    timeoutMs: 10_000,
    stateTtlSeconds: 600,
    refreshSkewSeconds: 60,
  };
  return BitrixAdapterModule.register({
    portalKey,
    namespace: `aasc-tiktok:${portalKey}`,
    bitrix,
  });
}
