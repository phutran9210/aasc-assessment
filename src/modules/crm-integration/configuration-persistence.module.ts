import { Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { CONFIGURATION_REVISION_READER } from './ports/configuration-revision-reader.port.js';
import { ConfigurationRepository } from './repositories/configuration.repository.js';

@Module({
  imports: [TiktokDatabaseModule],
  providers: [
    {
      provide: ConfigurationRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new ConfigurationRepository(dataSource),
    },
    { provide: CONFIGURATION_REVISION_READER, useExisting: ConfigurationRepository },
  ],
  exports: [ConfigurationRepository, CONFIGURATION_REVISION_READER],
})
export class ConfigurationPersistenceModule {}
