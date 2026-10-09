import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { AggregateLeaseRepository } from '@core/queue/repositories/aggregate-lease.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OperationRunnerService } from '@core/queue/services/operation-runner.service.js';
import { RecoverySweeperService } from '@core/queue/services/recovery-sweeper.service.js';
import { OutboxDispatcherService } from '@core/queue/services/outbox-dispatcher.service.js';
import { WorkerLifecycleService } from '@core/queue/services/worker-lifecycle.service.js';
import { WorkerHeartbeatService } from '@core/queue/services/worker-heartbeat.service.js';
import { TiktokDatabaseModule } from './database/database.module.js';
import { QueueModule } from '@core/queue/queue.module.js';
import { environmentBitrixAdapter } from './bitrix-adapter.config.js';
import { createTiktokWorkerHandlers } from './worker-handlers.js';
import type { OperationHandlerRegistry } from '@core/queue/types/worker.types.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { LeadIngestService } from '@modules/crm-integration/services/lead-ingest.service.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { LeadIdentityRepository } from '@modules/crm-integration/repositories/lead-identity.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { TiktokIngestHandler } from '@modules/crm-integration/workers/tiktok-ingest.handler.js';
import { LeadSyncService } from '@modules/crm-integration/services/lead-sync.service.js';
import { RemoteReconciliationService } from '@modules/crm-integration/services/remote-reconciliation.service.js';
import { TimelineService } from '@modules/crm-integration/services/timeline.service.js';
import { LeadSyncHandler } from '@modules/crm-integration/workers/lead-sync.handler.js';
import { TimelineHandler } from '@modules/crm-integration/workers/timeline.handler.js';
import { ConversionService } from '@modules/crm-integration/services/conversion.service.js';
import { AssignmentService } from '@modules/crm-integration/services/assignment.service.js';
import { AssignmentCursorRepository } from '@modules/crm-integration/repositories/assignment-cursor.repository.js';
import { DealRepository } from '@modules/crm-integration/repositories/deal.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { ConversionHandler } from '@modules/crm-integration/workers/conversion.handler.js';
import { CRM_GATEWAY } from '@modules/crm-integration/ports/crm-gateway.port.js';
import type { CrmGateway } from '@modules/crm-integration/ports/crm-gateway.port.js';
import { BitrixCrmGateway } from '@modules/crm-integration/gateways/bitrix-crm.gateway.js';
import { DealHistoryRepository } from '@modules/crm-integration/repositories/deal-history.repository.js';
import { DealRefreshService } from '@modules/crm-integration/services/deal-refresh.service.js';
import { DealRefreshHandler } from '@modules/crm-integration/workers/deal-refresh.handler.js';
import { DealPollService } from '@modules/crm-integration/services/deal-poll.service.js';
import { DealPollRepository } from '@modules/crm-integration/repositories/deal-poll.repository.js';
import { TimelineRepository } from '@modules/crm-integration/repositories/timeline.repository.js';
import { FeedbackRepository } from '@modules/crm-integration/repositories/feedback.repository.js';
import { DealPollSchedulerService } from '@modules/crm-integration/services/deal-poll-scheduler.service.js';
import { ConversionFeedbackService } from '@modules/tiktok/services/conversion-feedback.service.js';
import { CONVERSION_FEEDBACK } from '@modules/crm-integration/ports/conversion-feedback.port.js';
import type { ConversionFeedbackScheduler } from '@modules/crm-integration/ports/conversion-feedback.port.js';
import { FeedbackHandler } from '@modules/tiktok/workers/feedback.handler.js';
import { TIKTOK_FEEDBACK_PROVIDER } from '@modules/tiktok/ports/tiktok-feedback-provider.port.js';
import type { TiktokFeedbackProvider } from '@modules/tiktok/types/index.js';
import { MockTiktokAdapter } from '@modules/tiktok/adapters/mock-tiktok.adapter.js';
import {
  AnalyticsRepository,
  AnalyticsRevisionRepository,
  CampaignCostRepository,
  CampaignCostService,
  ScoreRecomputeService,
} from '@modules/integration-analytics/index.js';

import {
  AlertService,
  ConversionNotificationListener,
  ExportHandler,
  ImportHandler,
  NotificationHandler,
  NotificationService,
  REPORT_PROVIDERS,
  ReportScheduler,
  RetentionService,
  SchedulerRegistryService,
} from '@modules/integration-reports/index.js';
import type { ScheduledTask } from '@modules/integration-reports/index.js';

export const TIKTOK_OPERATION_HANDLERS = Symbol('TIKTOK_OPERATION_HANDLERS');

@Module({
  imports: [TiktokDatabaseModule, QueueModule, environmentBitrixAdapter()],
  providers: [
    ...REPORT_PROVIDERS,
    LeadRepository,
    LeadIdentityRepository,
    SubmissionRepository,
    AnalyticsRevisionRepository,
    {
      provide: AnalyticsRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new AnalyticsRepository(dataSource),
    },
    CampaignCostRepository,
    {
      provide: CampaignCostService,
      inject: [CampaignCostRepository, AnalyticsRevisionRepository],
      useFactory: (costs: CampaignCostRepository, revisions: AnalyticsRevisionRepository) =>
        new CampaignCostService(costs, revisions),
    },
    {
      provide: ScoreRecomputeService,
      inject: [
        getDataSourceToken('tiktok'),
        AnalyticsRepository,
        LeadRepository,
        SubmissionRepository,
        ConfigurationRepository,
        OperationRepository,
        OutboxRepository,
        AnalyticsRevisionRepository,
      ],
      useFactory: (
        dataSource: DataSource,
        analytics: AnalyticsRepository,
        leads: LeadRepository,
        submissions: SubmissionRepository,
        configurations: ConfigurationRepository,
        operations: OperationRepository,
        outbox: OutboxRepository,
        revisions: AnalyticsRevisionRepository,
      ) =>
        new ScoreRecomputeService(
          dataSource,
          analytics,
          leads,
          submissions,
          configurations,
          operations,
          outbox,
          revisions,
        ),
    },
    {
      // Lets API readiness see that this worker is alive.
      provide: WorkerHeartbeatService,
      inject: [REDIS_CONNECTION_FACTORY],
      useFactory: (redis: RedisConnectionFactory) => new WorkerHeartbeatService(redis),
    },
    {
      // One registry owns the recurring work; each task is also guarded by its own database lock.
      provide: SchedulerRegistryService,
      inject: [ReportScheduler, AlertService, ScoreRecomputeService, RetentionService],
      useFactory: (
        reports: ReportScheduler,
        alerts: AlertService,
        scores: ScoreRecomputeService,
        retention: RetentionService,
      ) => {
        const tasks: ScheduledTask[] = [
          { name: 'daily-report', intervalMs: 60_000, run: (now) => reports.tick(now) },
          { name: 'alerts', intervalMs: 60_000, run: (now) => alerts.evaluate(now) },
          {
            name: 'score-recompute',
            intervalMs: 24 * 60 * 60 * 1000,
            run: (now) => scores.run(now),
          },
          { name: 'retention', intervalMs: 24 * 60 * 60 * 1000, run: (now) => retention.run(now) },
        ];
        return new SchedulerRegistryService(tasks, validateTiktokEnv(process.env).schedulerEnabled);
      },
    },
    AssignmentCursorRepository,
    AssignmentService,
    DealRepository,
    {
      provide: DealPollService,
      inject: [
        getDataSourceToken('tiktok'),
        CRM_GATEWAY,
        OperationRepository,
        OutboxRepository,
        DealPollRepository,
      ],
      useFactory: (
        ds: DataSource,
        gateway: CrmGateway,
        operations: OperationRepository,
        outbox: OutboxRepository,
        pollData: DealPollRepository,
      ) => new DealPollService(ds, gateway, operations, outbox, pollData),
    },
    DealPollRepository,
    DealPollSchedulerService,
    DealHistoryRepository,
    {
      provide: DealRefreshService,
      inject: [
        getDataSourceToken('tiktok'),
        CRM_GATEWAY,
        DealHistoryRepository,
        DealRepository,
        OperationRepository,
        WebhookEventRepository,
        AnalyticsRevisionRepository,
        CONVERSION_FEEDBACK,
      ],
      useFactory: (
        ds: DataSource,
        gateway: CrmGateway,
        history: DealHistoryRepository,
        deals: DealRepository,
        operations: OperationRepository,
        events: WebhookEventRepository,
        analyticsRevisions: AnalyticsRevisionRepository,
        feedback: ConversionFeedbackScheduler,
      ) =>
        new DealRefreshService(
          ds,
          gateway,
          history,
          deals,
          operations,
          events,
          analyticsRevisions,
          feedback,
        ),
    },
    {
      provide: DealRefreshHandler,
      inject: [getDataSourceToken('tiktok'), DealRefreshService],
      useFactory: (ds: DataSource, refresh: DealRefreshService) =>
        new DealRefreshHandler(ds, refresh),
    },
    {
      provide: ConfigurationRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new ConfigurationRepository(dataSource),
    },
    OperationRepository,
    {
      provide: TIKTOK_FEEDBACK_PROVIDER,
      useFactory: (): TiktokFeedbackProvider =>
        new MockTiktokAdapter(
          process.env.TIKTOK_MOCK_BASE_URL ?? 'http://127.0.0.1:3002/tiktok',
          process.env.TIKTOK_MOCK_API_KEY ?? 'local-only-mock-key',
        ),
    },
    {
      provide: ConversionFeedbackService,
      inject: [
        getDataSourceToken('tiktok'),
        ConfigurationRepository,
        OperationRepository,
        OutboxRepository,
        TIKTOK_FEEDBACK_PROVIDER,
        FeedbackRepository,
      ],
      useFactory: (
        dataSource: DataSource,
        configurations: ConfigurationRepository,
        operations: OperationRepository,
        outbox: OutboxRepository,
        provider: TiktokFeedbackProvider,
        feedbackData: FeedbackRepository,
      ) =>
        new ConversionFeedbackService(
          dataSource,
          configurations,
          operations,
          outbox,
          provider,
          feedbackData,
        ),
    },
    FeedbackRepository,
    {
      // Operators are notified of conversion milestones next to the TikTok feedback schedule.
      provide: CONVERSION_FEEDBACK,
      inject: [NotificationService, ConversionFeedbackService],
      useFactory: (notifications: NotificationService, feedback: ConversionFeedbackService) =>
        new ConversionNotificationListener(notifications, feedback),
    },
    FeedbackHandler,
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
        TimelineRepository,
      ],
      useFactory: (
        dataSource: DataSource,
        gateway: CrmGateway,
        reconciliation: RemoteReconciliationService,
        operations: OperationRepository,
        outbox: OutboxRepository,
        timelines: TimelineRepository,
      ) => new TimelineService(dataSource, gateway, reconciliation, operations, outbox, timelines),
    },
    TimelineRepository,
    {
      provide: LeadIngestService,
      inject: [
        getDataSourceToken('tiktok'),
        LeadRepository,
        LeadIdentityRepository,
        SubmissionRepository,
        OperationRepository,
        OutboxRepository,
        WebhookEventRepository,
        ConfigurationRepository,
        AnalyticsRevisionRepository,
        CONVERSION_FEEDBACK,
      ],
      useFactory: (
        dataSource: DataSource,
        leads: LeadRepository,
        identities: LeadIdentityRepository,
        submissions: SubmissionRepository,
        operations: OperationRepository,
        outbox: OutboxRepository,
        webhookEvents: WebhookEventRepository,
        configurations: ConfigurationRepository,
        analyticsRevisions: AnalyticsRevisionRepository,
        feedback: ConversionFeedbackScheduler,
      ) => {
        const config = validateTiktokEnv(process.env);
        return new LeadIngestService(
          dataSource,
          leads,
          identities,
          submissions,
          operations,
          outbox,
          webhookEvents,
          configurations,
          analyticsRevisions,
          config.portalKey,
          config.defaultPhoneRegion,
          feedback,
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
        LeadRepository,
        SubmissionRepository,
        ConfigurationRepository,
        AnalyticsRevisionRepository,
        CRM_GATEWAY,
        RemoteReconciliationService,
        OperationRepository,
        OutboxRepository,
        TimelineService,
      ],
      useFactory: (
        dataSource: DataSource,
        leads: LeadRepository,
        submissions: SubmissionRepository,
        configurations: ConfigurationRepository,
        analyticsRevisions: AnalyticsRevisionRepository,
        gateway: CrmGateway,
        reconciliation: RemoteReconciliationService,
        operations: OperationRepository,
        outbox: OutboxRepository,
        timeline: TimelineService,
      ) =>
        new LeadSyncService(
          dataSource,
          leads,
          submissions,
          configurations,
          analyticsRevisions,
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
      inject: [getDataSourceToken('tiktok'), LeadSyncService, ConversionService],
      useFactory: (dataSource: DataSource, sync: LeadSyncService, conversions: ConversionService) =>
        new LeadSyncHandler(dataSource, sync, conversions),
    },
    {
      provide: TimelineHandler,
      inject: [getDataSourceToken('tiktok'), TimelineService],
      useFactory: (dataSource: DataSource, timeline: TimelineService) =>
        new TimelineHandler(dataSource, timeline),
    },
    {
      provide: ConversionService,
      inject: [
        getDataSourceToken('tiktok'),
        ConfigurationRepository,
        AssignmentService,
        OperationRepository,
        OutboxRepository,
        CRM_GATEWAY,
        RemoteReconciliationService,
        TimelineService,
        LeadRepository,
        SubmissionRepository,
        DealRepository,
        AnalyticsRevisionRepository,
        CONVERSION_FEEDBACK,
      ],
      useFactory: (
        dataSource: DataSource,
        configurations: ConfigurationRepository,
        assignments: AssignmentService,
        operations: OperationRepository,
        outbox: OutboxRepository,
        gateway: CrmGateway,
        reconciliation: RemoteReconciliationService,
        timeline: TimelineService,
        leads: LeadRepository,
        submissions: SubmissionRepository,
        deals: DealRepository,
        analyticsRevisions: AnalyticsRevisionRepository,
        feedback: ConversionFeedbackScheduler,
      ) =>
        new ConversionService(
          dataSource,
          configurations,
          assignments,
          operations,
          outbox,
          gateway,
          reconciliation,
          timeline,
          leads,
          submissions,
          deals,
          analyticsRevisions,
          feedback,
        ),
    },
    {
      provide: ConversionHandler,
      inject: [getDataSourceToken('tiktok'), ConversionService],
      useFactory: (dataSource: DataSource, conversions: ConversionService) =>
        new ConversionHandler(dataSource, conversions),
    },
    {
      provide: TIKTOK_OPERATION_HANDLERS,
      inject: [
        TiktokIngestHandler,
        LeadSyncHandler,
        TimelineHandler,
        ConversionHandler,
        DealRefreshHandler,
        FeedbackHandler,
        ExportHandler,
        ImportHandler,
        NotificationHandler,
      ],
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
