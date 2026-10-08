import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import type { DataSource } from 'typeorm';
import type { MigrationInterface } from 'typeorm';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { buildTiktokDataSource } from '@/apps/tiktok/database/data-source.js';

export type TestDatabase = {
  dataSource: DataSource;
  schema: string;
  close(): Promise<void>;
};

export async function createTestDatabase(
  migrations?: Array<new () => MigrationInterface>,
): Promise<TestDatabase> {
  const connectionString = process.env.TIKTOK_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('TIKTOK_TEST_DATABASE_URL is required for integration tests');

  const testUrl = new URL(connectionString);
  const databaseName = testUrl.pathname.slice(1);
  if (
    databaseName !== 'tiktok_test' ||
    !['127.0.0.1', 'localhost', 'postgres'].includes(testUrl.hostname)
  ) {
    throw new Error('Integration tests require the dedicated local tiktok_test database');
  }

  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString });
  const quotedSchema = `"${schema}"`;
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);

  const config = validateTiktokEnv({
    ...process.env,
    TIKTOK_DATABASE_URL: connectionString,
    TIKTOK_DATABASE_SCHEMA: schema,
    BITRIX_MOCK_EVENT_SECRET:
      process.env.BITRIX_MOCK_EVENT_SECRET ?? 'mock-bitrix-event-secret-tests',
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
