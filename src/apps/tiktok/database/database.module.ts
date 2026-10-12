import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';

import {
  describeConnectionUrl,
  safeErrorMessage,
  safeErrorStack,
} from '@common/logging/connection-log.js';
import { elapsedMs, Temporal } from '@common/utils/index.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from './data-source.js';

const logger = new Logger('TiktokDatabaseModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: 'tiktok',
      useFactory: () => buildTiktokDataSource(validateTiktokEnv(process.env)).options,
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('TikTok PostgreSQL options are required');

        const target = describePostgresTarget(options);
        const startedAt = Temporal.Now.instant();
        logger.log(`TikTok PostgreSQL connecting (${target})...`);
        try {
          const dataSource = new DataSource(options);
          await dataSource.initialize();
          logger.log(`TikTok PostgreSQL ready (${target}, ${elapsedMs(startedAt)} ms)`);
          return dataSource;
        } catch (error) {
          logger.error(
            `TikTok PostgreSQL initialization failed (${target}): ${safeErrorMessage(error)}`,
            safeErrorStack(error),
          );
          throw error;
        }
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class TiktokDatabaseModule {}

function describePostgresTarget(options: DataSourceOptions): string {
  const url = 'url' in options && options.url ? describeConnectionUrl(options.url) : 'no URL';
  const schema = 'schema' in options && options.schema ? options.schema : 'public';
  return `${url}, schema=${schema}`;
}
