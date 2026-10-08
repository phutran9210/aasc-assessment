import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadIngestSupport1791417603000 implements MigrationInterface {
  name = 'LeadIngestSupport1791417603000';

  private qualified(queryRunner: QueryRunner, name: string): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."${name}"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const submission = this.qualified(queryRunner, 'integration_submission');
    await queryRunner.query(
      `ALTER TABLE ${submission} ADD COLUMN association_status varchar(20) NOT NULL DEFAULT 'linked' CHECK (association_status IN ('linked', 'waiting_link', 'unmatched'))`,
    );
    await queryRunner.query(
      `ALTER TABLE ${submission} ADD COLUMN link_attempt_count integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE ${submission} ADD COLUMN next_link_attempt_at timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE ${submission} ADD COLUMN association_expires_at timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_submission_pending_link ON ${submission} (next_link_attempt_at) WHERE association_status = 'waiting_link'`,
    );
    const revision = this.qualified(queryRunner, 'integration_analytics_revision');
    await queryRunner.query(
      `CREATE TABLE ${revision} (id uuid PRIMARY KEY, revision bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    );
    await queryRunner.query(
      `INSERT INTO ${revision} (id, revision) VALUES ('00000000-0000-7000-8000-000000000001', 0)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const revision = this.qualified(queryRunner, 'integration_analytics_revision');
    const submission = this.qualified(queryRunner, 'integration_submission');
    await queryRunner.query(`DROP TABLE ${revision}`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${this.qualified(queryRunner, 'ix_integration_submission_pending_link')}`,
    );
    await queryRunner.query(
      `ALTER TABLE ${submission} DROP COLUMN association_expires_at, DROP COLUMN next_link_attempt_at, DROP COLUMN link_attempt_count, DROP COLUMN association_status`,
    );
  }
}
