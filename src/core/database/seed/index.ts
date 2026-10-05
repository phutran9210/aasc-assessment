/**
 * Seed entry point: fills the database with realistic sample data.
 *
 * Usage: `pnpm db:seed` (100 records) or `pnpm db:seed 250`.
 * WARNING: existing rows of the seeded tables are deleted first.
 */
import { appConfig } from '@config/index.js';
import type { AppConfig } from '@config/index.js';
import { seedTasks } from '@modules/task/seeders/task.seeder.js';

import { NestFactory } from '@nestjs/core';

import { DataSource } from 'typeorm';

import { AppModule } from '../../../app.module.js';
import { parseSeedCount } from './seed.util.js';

async function main(): Promise<void> {
  const count = parseSeedCount(process.argv[2]);

  // Reuses the app's own configuration, so the seed always targets the database in `.env`.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get<AppConfig>(appConfig.KEY);
    if (config.isProduction) {
      throw new Error('Không chạy seed khi NODE_ENV=production (seed xóa dữ liệu hiện có)');
    }

    console.log('Seeding database...');
    // Seed in dependency order: parents before children.
    await seedTasks(app.get(DataSource), { count });
    console.log('Done!');
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
