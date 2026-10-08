import { Module } from '@nestjs/common';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '../../apps/tiktok/database/database.module.js';
import { IntegrationAuthModule } from '../integration-auth/integration-auth.module.js';
import { BitrixCrmGateway } from './gateways/bitrix-crm.gateway.js';
import { CRM_GATEWAY } from './ports/crm-gateway.port.js';
import { ConfigurationController } from './controllers/configuration.controller.js';
import { ConfigurationRepository } from './repositories/configuration.repository.js';
import { ConfigurationService } from './services/configuration.service.js';
import { LeadConversionController } from './controllers/lead-conversion.controller.js';
import { AssignmentService } from './services/assignment.service.js';
import { ConversionService } from './services/conversion.service.js';
import { AssignmentCursorRepository } from './repositories/assignment-cursor.repository.js';
import { DealRepository } from './repositories/deal.repository.js';
import { OperationRepository } from '../../core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '../../core/queue/repositories/outbox.repository.js';
import { RemoteReconciliationService } from './services/remote-reconciliation.service.js';
import { TimelineService } from './services/timeline.service.js';
import type { CrmGateway } from './ports/crm-gateway.port.js';

export type CrmIntegrationModuleOptions = {
  imports?: Array<Type<unknown> | DynamicModule>;
  providers?: Provider[];
};

@Module({})
export class CrmIntegrationModule {
  static register(options: CrmIntegrationModuleOptions = {}): DynamicModule {
    return {
      module: CrmIntegrationModule,
      imports: [TiktokDatabaseModule, IntegrationAuthModule, ...(options.imports ?? [])],
      controllers: [ConfigurationController, LeadConversionController],
      providers: [
        {
          provide: ConfigurationRepository,
          inject: [getDataSourceToken('tiktok')],
          useFactory: (dataSource: DataSource) => new ConfigurationRepository(dataSource),
        },
        BitrixCrmGateway,
        { provide: CRM_GATEWAY, useExisting: BitrixCrmGateway },
        ConfigurationService,
        OperationRepository,
        OutboxRepository,
        RemoteReconciliationService,
        AssignmentCursorRepository,
        AssignmentService,
        DealRepository,
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
            ),
        },
        ...(options.providers ?? []),
      ],
      exports: [ConfigurationRepository, ConfigurationService, CRM_GATEWAY, ConversionService],
    };
  }
}
