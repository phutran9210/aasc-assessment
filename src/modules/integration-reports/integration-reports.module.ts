import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { QueueModule } from '@core/queue/queue.module.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { IntegrationAuthModule } from '@modules/integration-auth/index.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { ConfigurationPersistenceModule } from '@modules/crm-integration/configuration-persistence.module.js';
import { AuditEventRepository } from '@modules/crm-integration/repositories/audit-event.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { LeadIdentityRepository } from '@modules/crm-integration/repositories/lead-identity.repository.js';
import { LeadIngestService } from '@modules/crm-integration/services/lead-ingest.service.js';
import { IntegrationAnalyticsModule } from '@modules/integration-analytics/integration-analytics.module.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import { ImportsController } from './controllers/imports.controller.js';
import { ReportsController } from './controllers/reports.controller.js';
import { ReportRowErrorRepository } from './repositories/report-row-error.repository.js';
import { CampaignCostImportService } from './services/campaign-cost-import.service.js';
import { ImportJobSupport } from './services/import-job.support.js';
import { LeadImportService } from './services/lead-import.service.js';
import { ImportHandler } from './workers/import.handler.js';
import { ExportRepository } from './repositories/export.repository.js';
import { ReportJobRepository } from './repositories/report-job.repository.js';
import { ArtifactService } from './services/artifact.service.js';
import { ExportService } from './services/export.service.js';
import { ExportHandler } from './workers/export.handler.js';

/** Report providers shared by the API and the worker composition roots. */
export const REPORT_PROVIDERS: Provider[] = [
  {
    provide: ReportJobRepository,
    inject: [getDataSourceToken('tiktok')],
    useFactory: (dataSource: DataSource) => new ReportJobRepository(dataSource),
  },
  {
    provide: ExportRepository,
    inject: [getDataSourceToken('tiktok')],
    useFactory: (dataSource: DataSource) => new ExportRepository(dataSource),
  },
  {
    provide: ArtifactService,
    inject: [ReportJobRepository],
    useFactory: (jobs: ReportJobRepository) =>
      new ArtifactService(validateTiktokEnv(process.env).artifactDir, jobs),
  },
  {
    provide: ExportService,
    inject: [
      getDataSourceToken('tiktok'),
      ExportRepository,
      ReportJobRepository,
      ArtifactService,
      OperationRepository,
      OutboxRepository,
    ],
    useFactory: (
      dataSource: DataSource,
      exports: ExportRepository,
      jobs: ReportJobRepository,
      artifacts: ArtifactService,
      operations: OperationRepository,
      outbox: OutboxRepository,
    ) => {
      const config = validateTiktokEnv(process.env);
      return new ExportService(dataSource, exports, jobs, artifacts, operations, outbox, {
        advertiserId: config.advertiserId,
        tiktokMode: config.tiktokMode,
        bitrixMode: config.bitrixMode,
        reportTimezone: config.reportTimezone,
      });
    },
  },
  LeadIdentityRepository,
  AuditEventRepository,
  {
    provide: ReportRowErrorRepository,
    inject: [getDataSourceToken('tiktok')],
    useFactory: (dataSource: DataSource) => new ReportRowErrorRepository(dataSource),
  },
  {
    provide: ImportJobSupport,
    inject: [
      getDataSourceToken('tiktok'),
      ReportJobRepository,
      ReportRowErrorRepository,
      ArtifactService,
      OperationRepository,
      OutboxRepository,
    ],
    useFactory: (
      dataSource: DataSource,
      jobs: ReportJobRepository,
      rowErrors: ReportRowErrorRepository,
      artifacts: ArtifactService,
      operations: OperationRepository,
      outbox: OutboxRepository,
    ) => new ImportJobSupport(dataSource, jobs, rowErrors, artifacts, operations, outbox),
  },
  {
    provide: LeadImportService,
    inject: [
      getDataSourceToken('tiktok'),
      ImportJobSupport,
      WebhookEventRepository,
      // Only the worker composes the ingest pipeline; the API registers files and never runs them.
      { token: LeadIngestService, optional: true },
      ConfigurationRepository,
      LeadIdentityRepository,
      AuditEventRepository,
    ],
    useFactory: (
      dataSource: DataSource,
      support: ImportJobSupport,
      webhookEvents: WebhookEventRepository,
      ingest: LeadIngestService | undefined,
      configurations: ConfigurationRepository,
      identities: LeadIdentityRepository,
      audit: AuditEventRepository,
    ) => {
      const config = validateTiktokEnv(process.env);
      return new LeadImportService(
        dataSource,
        support,
        webhookEvents,
        ingest ?? null,
        configurations,
        identities,
        audit,
        {
          advertiserId: config.advertiserId,
          tiktokMode: config.tiktokMode,
          defaultPhoneRegion: config.defaultPhoneRegion,
        },
      );
    },
  },
  {
    provide: CampaignCostImportService,
    inject: [getDataSourceToken('tiktok'), ImportJobSupport, CampaignCostService],
    useFactory: (dataSource: DataSource, support: ImportJobSupport, costs: CampaignCostService) => {
      const config = validateTiktokEnv(process.env);
      return new CampaignCostImportService(dataSource, support, costs, {
        advertiserId: config.advertiserId,
        reportTimezone: config.reportTimezone,
      });
    },
  },
  {
    provide: ImportHandler,
    inject: [
      getDataSourceToken('tiktok'),
      ReportJobRepository,
      LeadImportService,
      CampaignCostImportService,
    ],
    useFactory: (
      dataSource: DataSource,
      jobs: ReportJobRepository,
      leadImports: LeadImportService,
      costImports: CampaignCostImportService,
    ) => new ImportHandler(dataSource, jobs, leadImports, costImports),
  },
  {
    provide: ExportHandler,
    inject: [getDataSourceToken('tiktok'), ExportService],
    useFactory: (dataSource: DataSource, exportService: ExportService) =>
      new ExportHandler(dataSource, exportService),
  },
];

@Module({
  imports: [
    TiktokDatabaseModule,
    QueueModule,
    IntegrationAuthModule,
    ConfigurationPersistenceModule,
    IntegrationAnalyticsModule,
  ],
  controllers: [ReportsController, ImportsController],
  providers: [...REPORT_PROVIDERS],
  exports: [
    ReportJobRepository,
    ReportRowErrorRepository,
    ArtifactService,
    ExportService,
    ExportHandler,
    LeadImportService,
    CampaignCostImportService,
    ImportHandler,
  ],
})
export class IntegrationReportsModule {}
