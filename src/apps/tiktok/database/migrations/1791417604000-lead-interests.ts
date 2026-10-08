import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadInterests1791417604000 implements MigrationInterface {
  name = 'LeadInterests1791417604000';

  private table(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."integration_lead"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} ADD COLUMN interests jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ${this.table(queryRunner)} DROP COLUMN interests`);
  }
}
