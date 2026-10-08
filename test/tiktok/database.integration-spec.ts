import { createTestDatabase } from './utils/test-database.js';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runMigrations } from '../../src/apps/tiktok/database/migration-runner.js';
import { IntegrationUserEntity } from '../../src/modules/integration-auth/entities/integration-user.entity.js';

class Failing1791417602000 implements MigrationInterface {
  name = 'Failing1791417602000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SELECT 1');
    throw new Error('intentional migration failure');
  }

  async down(): Promise<void> {}
}

describe('TikTok PostgreSQL database', () => {
  it('runs migrations repeatedly with an explicit PostgreSQL-only entity registry', async () => {
    const database = await createTestDatabase();
    try {
      const { dataSource } = database;
      expect(dataSource.options.type).toBe('postgres');
      expect(dataSource.options.synchronize).toBe(false);
      expect(dataSource.hasMetadata('IntegrationUserEntity')).toBe(true);
      expect(
        dataSource.getMetadata(IntegrationUserEntity).findColumnWithPropertyName('createdAt')
          ?.databaseName,
      ).toBe('created_at');
      expect(dataSource.hasMetadata('BitrixInstallationEntity')).toBe(true);
      expect(dataSource.hasMetadata('ConfigurationEntity')).toBe(true);
      expect(dataSource.hasMetadata('User')).toBe(false);
      expect(dataSource.entityMetadatas.map(({ tableName }) => tableName)).not.toContain('jotform');
      expect(dataSource.entityMetadatas.map(({ tableName }) => tableName)).not.toContain('caro');

      const previousUrl = process.env.TIKTOK_DATABASE_URL;
      const previousSchema = process.env.TIKTOK_DATABASE_SCHEMA;
      process.env.TIKTOK_DATABASE_URL = process.env.TIKTOK_TEST_DATABASE_URL;
      process.env.TIKTOK_DATABASE_SCHEMA = database.schema;
      try {
        await Promise.all([runMigrations(), runMigrations()]);
      } finally {
        if (previousUrl) process.env.TIKTOK_DATABASE_URL = previousUrl;
        else delete process.env.TIKTOK_DATABASE_URL;
        if (previousSchema) process.env.TIKTOK_DATABASE_SCHEMA = previousSchema;
        else delete process.env.TIKTOK_DATABASE_SCHEMA;
      }

      const tables = await dataSource.query<{ table_name: string }[]>(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        [database.schema],
      );
      const tableNames = tables.map(({ table_name }) => table_name);
      expect(tableNames.filter((table) => table === 'integration_user')).toHaveLength(1);
      expect(tableNames.filter((table) => table === 'integration_configuration')).toHaveLength(1);
      expect(
        tableNames.filter((table) => table === 'integration_bitrix_installation'),
      ).toHaveLength(1);
      expect(tableNames).toContain('migrations');
    } finally {
      await database.close();
    }
  });

  it('does not record or retain a failed migration', async () => {
    const database = await createTestDatabase([Failing1791417602000]);
    try {
      await expect(database.dataSource.runMigrations({ transaction: 'all' })).rejects.toThrow(
        'intentional migration failure',
      );
      const tables = await database.dataSource.query<{ table_name: string }[]>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'migrations'",
        [database.schema],
      );
      expect(tables).toHaveLength(1);
      const applied = await database.dataSource.query(
        `SELECT id FROM "${database.schema}"."migrations" WHERE name = $1`,
        ['Failing1791417602000'],
      );
      expect(applied).toHaveLength(0);
    } finally {
      await database.close();
    }
  });
});
