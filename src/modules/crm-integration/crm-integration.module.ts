import { Module } from '@nestjs/common';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { IntegrationAuthModule } from '../integration-auth/integration-auth.module.js';
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
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { BITRIX_INSTALLATION_STORE } from '../bitrix/ports/bitrix-installation-store.port.js';
import type { BitrixInstallationStore } from '../bitrix/ports/bitrix-installation-store.port.js';
import { BitrixApiService } from '../bitrix/services/bitrix-api.service.js';
import { DealPollService } from './services/deal-poll.service.js';
import { LeadsController } from './controllers/leads.controller.js';
import { DealsController } from './controllers/deals.controller.js';
import { OperationsController } from './controllers/operations.controller.js';
import { IntegrationReadService } from './services/integration-read.service.js';
import { IntegrationReadRepository } from './repositories/integration-read.repository.js';
import { OperationControlService } from './services/operation-control.service.js';
import { ConversionFeedbackService } from '../tiktok/services/conversion-feedback.service.js';
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
          ],
          useFactory: (
            dataSource: DataSource,
            configurations: ConfigurationRepository,
            operations: OperationRepository,
            outbox: OutboxRepository,
            provider: TiktokFeedbackProvider,
          ) =>
            new ConversionFeedbackService(dataSource, configurations, operations, outbox, provider),
        },
        WebhookEventRepository,
        DealHistoryRepository,
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
            ConfigurationRepository,
            CRM_GATEWAY,
            RemoteReconciliationService,
          ],
          useFactory: (
            dataSource: DataSource,
            outbox: OutboxRepository,
            configurations: ConfigurationRepository,
            gateway: CrmGateway,
            reconciliation: RemoteReconciliationService,
          ) =>
            new OperationControlService(
              dataSource,
              outbox,
              configurations,
              gateway,
              reconciliation,
            ),
        },
        {
          provide: DealPollService,
          inject: [
            getDataSourceToken('tiktok'),
            CRM_GATEWAY,
            OperationRepository,
            OutboxRepository,
          ],
          useFactory: (
            ds: DataSource,
            gateway: CrmGateway,
            operations: OperationRepository,
            outbox: OutboxRepository,
          ) => new DealPollService(ds, gateway, operations, outbox),
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
            ConversionFeedbackService,
          ],
          useFactory: (
            ds: DataSource,
            gateway: CrmGateway,
            history: DealHistoryRepository,
            deals: DealRepository,
            operations: OperationRepository,
            events: WebhookEventRepository,
            analyticsRevisions: AnalyticsRevisionRepository,
            feedback: ConversionFeedbackService,
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
            ConversionFeedbackService,
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
            feedback: ConversionFeedbackService,
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
              feedback,
            ),
        },
        ...(options.providers ?? []),
      ],
      exports: [
        ConfigurationRepository,
        ConfigurationService,
        CRM_GATEWAY,
        ConversionService,
        ConversionFeedbackService,
      ],
    };
  }
}
