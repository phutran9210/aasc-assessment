import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FeedbackLedger1791417608000 implements MigrationInterface {
  name = 'FeedbackLedger1791417608000';

  private table(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."integration_feedback_ledger"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${this.table(queryRunner)} (
        id uuid PRIMARY KEY,
        advertiser_id varchar(255) NOT NULL,
        lead_id uuid NOT NULL REFERENCES "${this.schema(queryRunner)}"."integration_lead"(id) ON DELETE RESTRICT,
        milestone varchar(32) NOT NULL CHECK (milestone IN ('lead_qualified', 'deal_created', 'deal_won')),
        event_id varchar(64) NOT NULL UNIQUE,
        status varchar(24) NOT NULL CHECK (status IN ('queued', 'accepted', 'rejected', 'skipped_no_consent', 'disabled')),
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_error_code varchar(100),
        operation_id uuid REFERENCES "${this.schema(queryRunner)}"."integration_operation"(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_feedback_milestone UNIQUE (advertiser_id, lead_id, milestone)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_feedback_status ON ${this.table(queryRunner)} (status, updated_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${this.table(queryRunner)}`);
  }

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return schema.replaceAll('"', '""');
  }
}
