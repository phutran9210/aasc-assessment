import { safeErrorMessage, safeErrorStack } from '@common/logging/connection-log.js';
import { elapsedMs, Temporal } from '@common/utils/index.js';
import { databaseConfig } from '@config/index.js';

import { Logger, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';

import { buildDatabaseOptions } from './database.options.js';

const logger = new Logger('DatabaseModule');

/** Opens the single SQLite DataSource. `DataSource` becomes injectable in every module. */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => buildDatabaseOptions(config),
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('SQLite options are required');

        // A file path or `:memory:`: SQLite has no credentials to hide.
        const target = `SQLite: ${String(options.database)}`;
        const startedAt = Temporal.Now.instant();
        logger.log(`Database connecting (${target})...`);
        try {
          const dataSource = new DataSource(options);
          await dataSource.initialize();
          logger.log(`Database ready (${target}, ${elapsedMs(startedAt)} ms)`);
          return dataSource;
        } catch (error) {
          logger.error(
            `Database initialization failed (${target}): ${safeErrorMessage(error)}`,
            safeErrorStack(error),
          );
          throw error;
        }
      },
    }),
  ],
})
export class DatabaseModule {}
