import { AppConfigModule } from '@config/index.js';
import { DatabaseModule } from '@core/database/index.js';
import { BitrixModule } from '@modules/bitrix/index.js';
import { GoogleSheetsModule } from '@modules/google-sheets/index.js';

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { LeadSyncEventsController } from './controllers/lead-sync-events.controller.js';
import { LeadSyncController } from './controllers/lead-sync.controller.js';
import { BitrixLeadGateway } from './gateways/bitrix-lead.gateway.js';
import { LeadSyncPendingLeadRepository } from './repositories/lead-sync-pending-lead.repository.js';
import { LeadSyncRunItemRepository } from './repositories/lead-sync-run-item.repository.js';
import { LeadSyncRunRepository } from './repositories/lead-sync-run.repository.js';
import { BitrixLeadEvents } from './services/bitrix-lead-events.service.js';
import { LeadPullback } from './services/lead-pullback.service.js';
import { LeadSheetSeeder } from './services/lead-sheet-seeder.service.js';
import { LeadSyncReadiness } from './services/lead-sync-readiness.service.js';
import { LeadSyncStatusService } from './services/lead-sync-status.service.js';
import { MappingLoader } from './services/mapping-loader.service.js';
import { SheetTable } from './services/sheet-table.service.js';
import { SyncRunner } from './services/sync-runner.service.js';
import { SyncScheduler } from './services/sync-scheduler.service.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    BitrixModule,
    GoogleSheetsModule,
  ],
  controllers: [LeadSyncController, LeadSyncEventsController],
  providers: [
    LeadSyncRunRepository,
    LeadSyncRunItemRepository,
    LeadSyncPendingLeadRepository,
    MappingLoader,
    SheetTable,
    BitrixLeadGateway,
    LeadSyncReadiness,
    SyncRunner,
    SyncScheduler,
    LeadSyncStatusService,
    LeadPullback,
    LeadSheetSeeder,
    BitrixLeadEvents,
  ],
  exports: [SyncRunner, SyncScheduler, LeadSheetSeeder],
})
export class LeadSyncModule {}
