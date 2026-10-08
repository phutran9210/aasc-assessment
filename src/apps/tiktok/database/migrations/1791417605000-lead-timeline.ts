import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadTimeline1791417605000 implements MigrationInterface {
  name = 'LeadTimeline1791417605000';

  private table(queryRunner: QueryRunner, name: string): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."${name}"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const timeline = this.table(queryRunner, 'integration_timeline');
    const lead = this.table(queryRunner, 'integration_lead');
    await queryRunner.query(`
      CREATE TABLE ${timeline} (
        id uuid PRIMARY KEY,
        lead_id uuid NOT NULL REFERENCES ${lead}(id) ON DELETE RESTRICT,
        entity_type varchar(16) NOT NULL CHECK (entity_type IN ('lead', 'deal')),
        remote_entity_id varchar(255),
        remote_timeline_id varchar(255),
        marker varchar(255) NOT NULL,
        comment text NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'reconcile_required')),
        attempt integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        last_error_code varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_timeline_marker UNIQUE (marker)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_timeline_pending ON ${timeline} (status, next_attempt_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ${this.table(queryRunner, 'integration_timeline')}`);
  }
}
