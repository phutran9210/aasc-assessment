import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import type { MigrationInterface } from 'typeorm';

import { validateTiktokEnv } from '../../../src/config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from '../../../src/apps/tiktok/database/data-source.js';

export type TestDatabase = {
  dataSource: DataSource;
  schema: string;
  close(): Promise<void>;
};

export async function createTestDatabase(migrations?: MigrationInterface[]): Promise<TestDatabase> {
  const connectionString = process.env.TIKTOK_TEST_DATABASE_URL ?? process.env.TIKTOK_DATABASE_URL;
  if (!connectionString)
    throw new Error('TIKTOK_TEST_DATABASE_URL is required for integration tests');

  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString });
  const quotedSchema = `"${schema}"`;
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);

  const config = validateTiktokEnv({
    ...process.env,
    TIKTOK_DATABASE_URL: connectionString,
    TIKTOK_DATABASE_SCHEMA: schema,
  });
  const dataSource = buildTiktokDataSource(config);
  if (migrations) dataSource.setOptions({ migrations });
  try {
    await dataSource.initialize();
  } catch (error) {
    await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    await adminPool.end();
    throw error;
  }

  return {
    dataSource,
    schema,
    async close() {
      if (dataSource.isInitialized) await dataSource.destroy();
      await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
      await adminPool.end();
    },
  };
}
