import { databaseConfig } from '@config/index.js';

import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildDatabaseOptions } from './database.options.js';

/** Opens the single SQLite DataSource. `DataSource` becomes injectable in every module. */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => buildDatabaseOptions(config),
    }),
  ],
})
export class DatabaseModule {}
