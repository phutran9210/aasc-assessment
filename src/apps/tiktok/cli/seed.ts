import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from '../database/data-source.js';
import { seedDemo } from '../database/seed.js';

const logger = new Logger('TikTokSeed');

async function main(): Promise<void> {
  const config = validateTiktokEnv(process.env);
  const dataSource = buildTiktokDataSource(config);
  try {
    await dataSource.initialize();
    const summary = await seedDemo(dataSource, config);
    logger.log(`Demo data ready: ${JSON.stringify(summary)}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
