import type { MigrationInterface, QueryRunner } from 'typeorm';

function table(schema: string, name: string): string {
  const safeSchema = schema.replaceAll('"', '""');
  const safeName = name.replaceAll('"', '""');
  return `"${safeSchema}"."${safeName}"`;
}

export class Foundation1791417600000 implements MigrationInterface {
  name = 'Foundation1791417600000';

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    return 'schema' in options ? (options.schema ?? 'public') : 'public';
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${table(schema, 'integration_user')} (
        id uuid PRIMARY KEY,
        username varchar(80) NOT NULL,
        password_hash text NOT NULL,
        roles text[] NOT NULL DEFAULT ARRAY['integration_analyst']::text[],
        active boolean NOT NULL DEFAULT true,
        auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_user_username UNIQUE (username)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${table(schema, 'integration_bitrix_installation')} (
        id uuid PRIMARY KEY,
        portal_key varchar(128) NOT NULL UNIQUE,
        member_id varchar(128) UNIQUE,
        domain varchar(253) NOT NULL,
        client_endpoint text,
        access_token text,
        refresh_token text,
        access_token_expires_at timestamptz,
        refresh_lease_until timestamptz,
        refresh_lease_token uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${table(schema, 'integration_configuration')} (
        id uuid PRIMARY KEY,
        config_key varchar(100) NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        value jsonb NOT NULL,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_configuration_key_revision UNIQUE (config_key, revision)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${table(schema, 'integration_configuration_head')} (
        config_key varchar(100) PRIMARY KEY,
        revision integer NOT NULL,
        CONSTRAINT fk_integration_configuration_head_revision
          FOREIGN KEY (config_key, revision)
          REFERENCES ${table(schema, 'integration_configuration')} (config_key, revision)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(`DROP TABLE ${table(schema, 'integration_configuration_head')}`);
    await queryRunner.query(`DROP TABLE ${table(schema, 'integration_configuration')}`);
    await queryRunner.query(`DROP TABLE ${table(schema, 'integration_bitrix_installation')}`);
    await queryRunner.query(`DROP TABLE ${table(schema, 'integration_user')}`);
  }
}
