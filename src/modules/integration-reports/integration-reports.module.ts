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
import { ReportsController } from './controllers/reports.controller.js';
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
  {
    provide: ExportHandler,
    inject: [getDataSourceToken('tiktok'), ExportService],
    useFactory: (dataSource: DataSource, exportService: ExportService) =>
      new ExportHandler(dataSource, exportService),
  },
];

@Module({
  imports: [TiktokDatabaseModule, QueueModule, IntegrationAuthModule],
  controllers: [ReportsController],
  providers: [...REPORT_PROVIDERS],
  exports: [ReportJobRepository, ArtifactService, ExportService, ExportHandler],
})
export class IntegrationReportsModule {}
