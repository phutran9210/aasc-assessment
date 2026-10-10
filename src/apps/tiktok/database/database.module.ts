import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';

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

        logger.debug('TikTok PostgreSQL connecting...');
        try {
          const dataSource = new DataSource(options);
          await dataSource.initialize();
          logger.log('TikTok PostgreSQL ready');
          return dataSource;
        } catch (error) {
          logger.error('TikTok PostgreSQL initialization failed');
          throw error;
        }
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class TiktokDatabaseModule {}
