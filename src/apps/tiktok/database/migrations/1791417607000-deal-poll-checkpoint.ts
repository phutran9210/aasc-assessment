import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DealPollCheckpoint1791417607000 implements MigrationInterface {
  name = 'DealPollCheckpoint1791417607000';

  private table(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."integration_deal_poll_checkpoint"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${this.table(queryRunner)} (
        id uuid PRIMARY KEY,
        portal_key varchar(128) NOT NULL UNIQUE,
        incremental_watermark timestamptz,
        full_scan_at timestamptz,
        active_mode varchar(16) CHECK (active_mode IN ('incremental', 'full')),
        page_offset integer NOT NULL DEFAULT 0 CHECK (page_offset >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${this.table(queryRunner)}`);
  }
}
