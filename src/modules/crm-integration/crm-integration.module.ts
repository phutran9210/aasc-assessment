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
      controllers: [ConfigurationController],
      providers: [
        {
          provide: ConfigurationRepository,
          inject: [getDataSourceToken('tiktok')],
          useFactory: (dataSource: DataSource) => new ConfigurationRepository(dataSource),
        },
        BitrixCrmGateway,
        { provide: CRM_GATEWAY, useExisting: BitrixCrmGateway },
        ConfigurationService,
        ...(options.providers ?? []),
      ],
      exports: [ConfigurationRepository, ConfigurationService, CRM_GATEWAY],
    };
  }
}
