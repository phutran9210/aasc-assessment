import type { MigrationInterface, QueryRunner } from 'typeorm';

function table(schema: string): string {
  const safeSchema = schema.replaceAll('"', '""');
  return `"${safeSchema}"."integration_bitrix_installation"`;
}

export class BitrixInstallationFields1791417602000 implements MigrationInterface {
  name = 'BitrixInstallationFields1791417602000';

  private table(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return table(schema);
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const installation = this.table(queryRunner);
    await queryRunner.query(`ALTER TABLE ${installation} ADD COLUMN server_endpoint text`);
    await queryRunner.query(`ALTER TABLE ${installation} ADD COLUMN scope text`);
    await queryRunner.query(`ALTER TABLE ${installation} ADD COLUMN status varchar(32)`);
    await queryRunner.query(`ALTER TABLE ${installation} ADD COLUMN application_token text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const installation = this.table(queryRunner);
    await queryRunner.query(`ALTER TABLE ${installation} DROP COLUMN application_token`);
    await queryRunner.query(`ALTER TABLE ${installation} DROP COLUMN status`);
    await queryRunner.query(`ALTER TABLE ${installation} DROP COLUMN scope`);
    await queryRunner.query(`ALTER TABLE ${installation} DROP COLUMN server_endpoint`);
  }
}
