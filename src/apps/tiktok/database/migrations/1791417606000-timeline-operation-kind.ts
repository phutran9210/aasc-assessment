import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TimelineOperationKind1791417606000 implements MigrationInterface {
  name = 'TimelineOperationKind1791417606000';

  private table(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    return `"${schema.replaceAll('"', '""')}"."integration_operation"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} DROP CONSTRAINT integration_operation_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} ADD CONSTRAINT integration_operation_kind_check CHECK (kind IN ('tiktok_ingest', 'bitrix_lead_sync', 'crm_timeline', 'bitrix_deal_convert', 'bitrix_deal_refresh', 'tiktok_feedback', 'integration_report', 'integration_notification', 'integration_dlq', 'historical_lead_import', 'campaign_cost_import'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} DROP CONSTRAINT integration_operation_kind_check`,
    );
    await queryRunner.query(
      `ALTER TABLE ${this.table(queryRunner)} ADD CONSTRAINT integration_operation_kind_check CHECK (kind IN ('tiktok_ingest', 'bitrix_lead_sync', 'bitrix_deal_convert', 'bitrix_deal_refresh', 'tiktok_feedback', 'integration_report', 'integration_notification', 'integration_dlq', 'historical_lead_import', 'campaign_cost_import'))`,
    );
  }
}
