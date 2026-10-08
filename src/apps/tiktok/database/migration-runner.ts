import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { validateTiktokEnv } from '../../../config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from './data-source.js';

const logger = new Logger('TikTokMigrationRunner');

export async function runMigrations(): Promise<void> {
  const config = validateTiktokEnv(process.env);
  const dataSource = buildTiktokDataSource(config);
  const lockConnection = dataSource.createQueryRunner();
  let locked = false;

  try {
    await dataSource.initialize();
    await lockConnection.connect();
    await lockConnection.query("SELECT pg_advisory_lock(hashtext('aasc-tiktok-migrations'))");
    locked = true;
    const migrations = await dataSource.runMigrations({ transaction: 'all' });
    logger.log(`Applied ${migrations.length} TikTok database migration(s)`);
  } finally {
    if (locked) {
      await lockConnection.query("SELECT pg_advisory_unlock(hashtext('aasc-tiktok-migrations'))");
    }
    if (lockConnection.isReleased === false) await lockConnection.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

if (process.argv[1]?.endsWith('/migration-runner.js')) {
  void runMigrations().catch((error: unknown) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
