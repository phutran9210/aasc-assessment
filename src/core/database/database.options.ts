import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { ENTITIES } from './entities/index.js';

export const IN_MEMORY_DATABASE = ':memory:';

type DatabaseSettings = {
  path: string;
  synchronize: boolean;
  logging: boolean;
};

/**
 * Builds the SQLite connection options.
 * For a file database the parent folder is created first, because SQLite will not create it.
 */
export function buildDatabaseOptions(settings: DatabaseSettings): TypeOrmModuleOptions {
  const isFile = settings.path !== IN_MEMORY_DATABASE;
  if (isFile) mkdirSync(dirname(settings.path), { recursive: true });

  return {
    type: 'better-sqlite3',
    database: settings.path,
    entities: ENTITIES,
    synchronize: settings.synchronize,
    logging: settings.logging,
    // WAL lets readers and one writer work concurrently (needed by the realtime game modules).
    enableWAL: isFile,
  };
}
