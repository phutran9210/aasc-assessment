import { Module } from '@nestjs/common';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { IntegrationAuthModule } from '@modules/integration-auth/index.js';
import { BitrixCrmGateway } from './gateways/bitrix-crm.gateway.js';
import { CRM_GATEWAY } from './ports/crm-gateway.port.js';
import { ConfigurationController } from './controllers/configuration.controller.js';
import { ConfigurationRepository } from './repositories/configuration.repository.js';
import { ConfigurationPersistenceModule } from './configuration-persistence.module.js';
import { ConfigurationService } from './services/configuration.service.js';
import { LeadConversionController } from './controllers/lead-conversion.controller.js';
import { AssignmentService } from './services/assignment.service.js';
import { ConversionService } from './services/conversion.service.js';
import { AssignmentCursorRepository } from './repositories/assignment-cursor.repository.js';
import { DealRepository } from './repositories/deal.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { RemoteReconciliationService } from './services/remote-reconciliation.service.js';
import { TimelineService } from './services/timeline.service.js';
import type { CrmGateway } from './ports/crm-gateway.port.js';
import { BitrixDealWebhookController } from './controllers/bitrix-deal-webhook.controller.js';
import { BitrixDealInbox } from './services/bitrix-deal-inbox.service.js';
import { DealRefreshService } from './services/deal-refresh.service.js';
import { DealHistoryRepository } from './repositories/deal-history.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/index.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { BITRIX_INSTALLATION_STORE, BitrixApiService } from '@modules/bitrix/index.js';
import type { BitrixInstallationStore } from '@modules/bitrix/index.js';
import { DealPollService } from './services/deal-poll.service.js';
import { DealPollRepository } from './repositories/deal-poll.repository.js';
import { TimelineRepository } from './repositories/timeline.repository.js';
import { FeedbackRepository } from './repositories/feedback.repository.js';
import { LeadRepository } from './repositories/lead.repository.js';
import { SubmissionRepository } from './repositories/submission.repository.js';
import { LeadIdentityRepository } from './repositories/lead-identity.repository.js';
import { AuditEventRepository } from './repositories/audit-event.repository.js';
import { LeadsController } from './controllers/leads.controller.js';
import { DealsController } from './controllers/deals.controller.js';
import { OperationsController } from './controllers/operations.controller.js';
import { IntegrationReadService } from './services/integration-read.service.js';
import { IntegrationReadRepository } from './repositories/integration-read.repository.js';
import { OperationControlService } from './services/operation-control.service.js';
import { ConversionFeedbackService } from '../tiktok/services/conversion-feedback.service.js';
import { CONVERSION_FEEDBACK } from './ports/conversion-feedback.port.js';
import type { ConversionFeedbackScheduler } from './ports/conversion-feedback.port.js';
import { MockTiktokAdapter } from '../tiktok/adapters/mock-tiktok.adapter.js';
import { TIKTOK_FEEDBACK_PROVIDER } from '../tiktok/ports/tiktok-feedback-provider.port.js';
import type { TiktokFeedbackProvider } from '../tiktok/ports/tiktok-feedback-provider.port.js';

export type CrmIntegrationModuleOptions = {
  imports?: Array<Type<unknown> | DynamicModule>;
  providers?: Provider[];
};

@Module({})
export class CrmIntegrationModule {
  static register(options: CrmIntegrationModuleOptions = {}): DynamicModule {
    return {
      module: CrmIntegrationModule,
      imports: [
        TiktokDatabaseModule,
        ConfigurationPersistenceModule,
        IntegrationAuthModule,
        ...(options.imports ?? []),
      ],
      controllers: [
        ConfigurationController,
        LeadConversionController,
        BitrixDealWebhookController,
        LeadsController,
        DealsController,
        OperationsController,
      ],
      providers: [
        BitrixCrmGateway,
        { provide: CRM_GATEWAY, useExisting: BitrixCrmGateway },
        ConfigurationService,
        OperationRepository,
        OutboxRepository,
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
        { provide: CONVERSION_FEEDBACK, useExisting: ConversionFeedbackService },
        WebhookEventRepository,
        DealHistoryRepository,
        DealPollRepository,
        TimelineRepository,
        FeedbackRepository,
        LeadRepository,
        SubmissionRepository,
        LeadIdentityRepository,
        AuditEventRepository,
        IntegrationReadService,
        {
          provide: IntegrationReadRepository,
          inject: [getDataSourceToken('tiktok')],
          useFactory: (dataSource: DataSource) => new IntegrationReadRepository(dataSource),
        },
        {
          provide: OperationControlService,
          inject: [
            getDataSourceToken('tiktok'),
            OutboxRepository,
            OperationRepository,
            LeadRepository,
            DealRepository,
            ConfigurationRepository,
            CRM_GATEWAY,
            RemoteReconciliationService,
            WebhookEventRepository,
            LeadIdentityRepository,
            AuditEventRepository,
          ],
          useFactory: (
            dataSource: DataSource,
            outbox: OutboxRepository,
            operations: OperationRepository,
            leads: LeadRepository,
            deals: DealRepository,
            configurations: ConfigurationRepository,
            gateway: CrmGateway,
            reconciliation: RemoteReconciliationService,
            webhookEvents: WebhookEventRepository,
            identities: LeadIdentityRepository,
            auditEvents: AuditEventRepository,
          ) =>
            new OperationControlService(
              dataSource,
              outbox,
              operations,
              leads,
              deals,
              configurations,
              gateway,
              reconciliation,
              webhookEvents,
              identities,
              auditEvents,
            ),
        },
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
        {
          provide: BitrixDealInbox,
          inject: [
            getDataSourceToken('tiktok'),
            WebhookEventRepository,
            OperationRepository,
            OutboxRepository,
            BitrixApiService,
            BITRIX_INSTALLATION_STORE,
          ],
          useFactory: (
            ds: DataSource,
            events: WebhookEventRepository,
            operations: OperationRepository,
            outbox: OutboxRepository,
            api: BitrixApiService,
            installations: BitrixInstallationStore,
          ) => new BitrixDealInbox(ds, events, operations, outbox, api, installations),
        },
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
        RemoteReconciliationService,
        AssignmentCursorRepository,
        AssignmentService,
        DealRepository,
        AnalyticsRevisionRepository,
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
          ) =>
            new TimelineService(dataSource, gateway, reconciliation, operations, outbox, timelines),
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
        ...(options.providers ?? []),
      ],
      exports: [
        // Nest only re-exports another module's providers through the module itself.
        ConfigurationPersistenceModule,
        ConfigurationService,
        CRM_GATEWAY,
        ConversionService,
        ConversionFeedbackService,
      ],
    };
  }
}
