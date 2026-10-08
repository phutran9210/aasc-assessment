import 'reflect-metadata';

import { DataSource } from 'typeorm';

import type { TiktokAppConfig } from '../../../config/tiktok-app/env.validation.js';
import { TIKTOK_ENTITIES } from './entities.js';
import { Foundation1791417600000 } from './migrations/1791417600000-foundation.js';

export function buildTiktokDataSource(config: TiktokAppConfig): DataSource {
  return new DataSource({
    type: 'postgres',
    url: config.databaseUrl,
    schema: config.databaseSchema,
    entities: [...TIKTOK_ENTITIES],
    migrations: [Foundation1791417600000],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'all',
    migrationsRun: false,
    synchronize: false,
    logging: false,
  });
}
