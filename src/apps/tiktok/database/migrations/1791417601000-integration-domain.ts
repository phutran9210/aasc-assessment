import type { MigrationInterface, QueryRunner } from 'typeorm';

function table(schema: string, name: string): string {
  const safeSchema = schema.replaceAll('"', '""');
  const safeName = name.replaceAll('"', '""');
  return `"${safeSchema}"."${safeName}"`;
}

export class IntegrationDomain1791417601000 implements MigrationInterface {
  name = 'IntegrationDomain1791417601000';

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    return 'schema' in options ? (options.schema ?? 'public') : 'public';
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    const q = (name: string) => table(schema, name);

    await queryRunner.query(`
      CREATE TABLE ${q('integration_webhook_event')} (
        id uuid PRIMARY KEY,
        provider varchar(32) NOT NULL CHECK (provider IN ('tiktok', 'bitrix24')),
        provider_mode varchar(20) NOT NULL CHECK (provider_mode IN ('mock', 'business-api', 'real')),
        scope_key varchar(255) NOT NULL,
        advertiser_id varchar(255),
        portal_key varchar(128),
        event_key varchar(255) NOT NULL,
        event_type varchar(100) NOT NULL,
        occurred_at timestamptz,
        received_at timestamptz NOT NULL DEFAULT now(),
        raw_body bytea NOT NULL,
        payload jsonb NOT NULL,
        payload_hash varchar(64) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'received'
          CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'quarantined', 'dead_letter')),
        error_code varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_webhook_event_key UNIQUE (provider, provider_mode, scope_key, event_key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_webhook_status_received ON ${q('integration_webhook_event')} (status, received_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_lead')} (
        id uuid PRIMARY KEY,
        external_id varchar(255) NOT NULL UNIQUE,
        scope_key varchar(255) NOT NULL,
        advertiser_id varchar(255) NOT NULL,
        portal_key varchar(128) NOT NULL,
        provider_mode varchar(20) NOT NULL CHECK (provider_mode IN ('mock', 'business-api')),
        name varchar(255) NOT NULL,
        email varchar(254),
        phone varchar(32),
        city varchar(255),
        score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
        score_version integer NOT NULL DEFAULT 1 CHECK (score_version > 0),
        score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
        business_status varchar(24) NOT NULL DEFAULT 'new'
          CHECK (business_status IN ('new', 'qualified', 'converted', 'disqualified')),
        sync_status varchar(24) NOT NULL DEFAULT 'pending'
          CHECK (sync_status IN ('pending', 'syncing', 'synced', 'retry_wait', 'reconcile_required', 'failed')),
        bitrix_lead_id varchar(255),
        first_submission_id uuid,
        last_submission_id uuid,
        first_touch_at timestamptz NOT NULL,
        first_touch_campaign_id varchar(255),
        last_touch_at timestamptz,
        converted_at timestamptz,
        deal_created_at timestamptz,
        field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_written_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        last_error_code varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_lead_portal_remote_id UNIQUE (portal_key, bitrix_lead_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_lead_sync_updated ON ${q('integration_lead')} (sync_status, updated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_lead_advertiser_created ON ${q('integration_lead')} (advertiser_id, created_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_lead_first_touch ON ${q('integration_lead')} (advertiser_id, first_touch_at, id)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_lead_identity')} (
        id uuid PRIMARY KEY,
        advertiser_id varchar(255) NOT NULL,
        identity_type varchar(16) NOT NULL CHECK (identity_type IN ('email', 'phone')),
        normalized_value varchar(254) NOT NULL,
        lead_id uuid NOT NULL REFERENCES ${q('integration_lead')}(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_lead_identity_value UNIQUE (advertiser_id, identity_type, normalized_value)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_lead_identity_lead ON ${q('integration_lead_identity')} (lead_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_submission')} (
        id uuid PRIMARY KEY,
        advertiser_id varchar(255) NOT NULL,
        provider_mode varchar(20) NOT NULL CHECK (provider_mode IN ('mock', 'business-api')),
        lead_id uuid REFERENCES ${q('integration_lead')}(id) ON DELETE RESTRICT,
        event_id uuid NOT NULL REFERENCES ${q('integration_webhook_event')}(id) ON DELETE RESTRICT,
        provider_lead_id varchar(255),
        submission_key varchar(255) NOT NULL,
        campaign_id varchar(255),
        campaign_name varchar(255),
        ad_id varchar(255),
        ad_name varchar(255),
        form_id varchar(255),
        form_name varchar(255),
        ttclid varchar(255),
        utm jsonb NOT NULL DEFAULT '{}'::jsonb,
        custom_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
        engagement jsonb NOT NULL DEFAULT '{}'::jsonb,
        consent jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL,
        is_historical boolean NOT NULL DEFAULT false,
        apply_rules boolean NOT NULL DEFAULT true,
        send_feedback boolean NOT NULL DEFAULT true,
        payload_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_submission_key UNIQUE (advertiser_id, provider_mode, submission_key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_submission_campaign_time ON ${q('integration_submission')} (advertiser_id, campaign_id, occurred_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_submission_lead_time ON ${q('integration_submission')} (lead_id, occurred_at)`,
    );
    await queryRunner.query(
      `ALTER TABLE ${q('integration_lead')} ADD CONSTRAINT fk_integration_lead_first_submission FOREIGN KEY (first_submission_id) REFERENCES ${q('integration_submission')}(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${q('integration_lead')} ADD CONSTRAINT fk_integration_lead_last_submission FOREIGN KEY (last_submission_id) REFERENCES ${q('integration_submission')}(id) ON DELETE SET NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_deal')} (
        id uuid PRIMARY KEY,
        lead_id uuid NOT NULL UNIQUE REFERENCES ${q('integration_lead')}(id) ON DELETE RESTRICT,
        portal_key varchar(128) NOT NULL,
        bitrix_deal_id varchar(255),
        title varchar(255) NOT NULL,
        amount numeric(20,4) CHECK (amount IS NULL OR amount >= 0),
        currency varchar(3),
        pipeline_id varchar(255) NOT NULL,
        stage_id varchar(255) NOT NULL,
        stage_semantics varchar(16) NOT NULL DEFAULT 'open' CHECK (stage_semantics IN ('open', 'won', 'lost')),
        stage_deleted_at timestamptz,
        probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
        assigned_to varchar(255),
        rule_revision integer NOT NULL CHECK (rule_revision > 0),
        conversion_status varchar(32) NOT NULL DEFAULT 'pending'
          CHECK (conversion_status IN ('pending', 'creating_deal', 'deal_created', 'completing_lead', 'completed', 'retry_wait', 'reconcile_required', 'failed')),
        remote_modified_at timestamptz,
        ever_won_at timestamptz,
        current_snapshot_hash varchar(64),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_deal_remote_id UNIQUE (portal_key, bitrix_deal_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_deal_stage_assignee ON ${q('integration_deal')} (stage_semantics, assigned_to, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_deal_history')} (
        id uuid PRIMARY KEY,
        deal_id uuid NOT NULL REFERENCES ${q('integration_deal')}(id) ON DELETE RESTRICT,
        previous_stage_id varchar(255),
        current_stage_id varchar(255) NOT NULL,
        previous_semantics varchar(16),
        current_semantics varchar(16) NOT NULL CHECK (current_semantics IN ('open', 'won', 'lost')),
        amount numeric(20,4) CHECK (amount IS NULL OR amount >= 0),
        currency varchar(3),
        provider_revision_key varchar(255) NOT NULL,
        observed_at timestamptz NOT NULL,
        effective_at timestamptz NOT NULL,
        source_complete boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_deal_history_revision UNIQUE (deal_id, provider_revision_key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_deal_history_effective ON ${q('integration_deal_history')} (deal_id, effective_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_assignment_cursor')} (
        id uuid PRIMARY KEY,
        cursor_key varchar(255) NOT NULL UNIQUE,
        last_assignee_id varchar(255),
        position bigint NOT NULL DEFAULT 0 CHECK (position >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${q('integration_audit_event')} (
        id uuid PRIMARY KEY,
        scope_key varchar(255) NOT NULL,
        actor_id uuid,
        event_type varchar(100) NOT NULL,
        aggregate_type varchar(64),
        aggregate_id uuid,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_audit_scope_created ON ${q('integration_audit_event')} (scope_key, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_audit_actor_created ON ${q('integration_audit_event')} (actor_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_operation')} (
        id uuid PRIMARY KEY,
        operation_key varchar(512) NOT NULL UNIQUE,
        kind varchar(64) NOT NULL CHECK (kind IN ('tiktok_ingest', 'bitrix_lead_sync', 'bitrix_deal_convert', 'bitrix_deal_refresh', 'tiktok_feedback', 'integration_report', 'integration_notification', 'integration_dlq', 'historical_lead_import', 'campaign_cost_import')),
        aggregate_id uuid,
        target_version integer,
        status varchar(24) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'retry_wait', 'reconcile_required', 'quarantined', 'succeeded', 'dead_letter', 'cancelled')),
        attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        lease_until timestamptz,
        lease_token uuid,
        remote_id varchar(255),
        last_error_code varchar(100),
        last_error_detail text,
        next_attempt_at timestamptz,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        config_revisions jsonb NOT NULL DEFAULT '{}'::jsonb,
        actor_id uuid,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_operation_status_next_attempt ON ${q('integration_operation')} (status, next_attempt_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_operation_aggregate_version ON ${q('integration_operation')} (aggregate_id, target_version)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_outbox')} (
        id uuid PRIMARY KEY,
        operation_id uuid NOT NULL REFERENCES ${q('integration_operation')}(id) ON DELETE RESTRICT,
        queue varchar(64) NOT NULL CHECK (queue IN ('tiktok-ingest', 'bitrix-lead-sync', 'bitrix-deal-convert', 'bitrix-deal-refresh', 'tiktok-feedback', 'integration-report', 'integration-notification', 'integration-dlq')),
        dispatch_generation integer NOT NULL DEFAULT 1 CHECK (dispatch_generation > 0),
        job_key varchar(300) NOT NULL UNIQUE,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        available_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        lease_until timestamptz,
        lease_owner uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_outbox_available ON ${q('integration_outbox')} (published_at, available_at)`,
    );
    await queryRunner.query(`
      CREATE TABLE ${q('integration_aggregate_lease')} (
        lease_key varchar(512) PRIMARY KEY,
        owner_token uuid NOT NULL,
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${q('integration_campaign_daily')} (
        id uuid PRIMARY KEY,
        advertiser_id varchar(255) NOT NULL,
        campaign_id varchar(255) NOT NULL,
        report_date date NOT NULL,
        reporting_timezone varchar(80) NOT NULL,
        currency varchar(3) NOT NULL,
        spend numeric(20,4) NOT NULL CHECK (spend >= 0),
        impressions bigint CHECK (impressions IS NULL OR impressions >= 0),
        clicks bigint CHECK (clicks IS NULL OR clicks >= 0),
        source varchar(16) NOT NULL CHECK (source IN ('mock', 'import', 'api')),
        fetched_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_campaign_daily_natural_key UNIQUE (advertiser_id, campaign_id, report_date, currency)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_campaign_daily_campaign_date ON ${q('integration_campaign_daily')} (campaign_id, report_date)`,
    );

    await queryRunner.query(`
      CREATE TABLE ${q('integration_report_job')} (
        id uuid PRIMARY KEY,
        kind varchar(32) NOT NULL CHECK (kind IN ('export', 'import', 'scheduled')),
        requester_id uuid,
        filters jsonb NOT NULL DEFAULT '{}'::jsonb,
        snapshot_at timestamptz,
        status varchar(24) NOT NULL DEFAULT 'pending',
        cursor varchar(255),
        total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
        success_rows integer NOT NULL DEFAULT 0 CHECK (success_rows >= 0),
        failed_rows integer NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
        artifact_path text,
        artifact_hash varchar(64),
        expires_at timestamptz,
        error_summary text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_report_job_owner_created ON ${q('integration_report_job')} (requester_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_integration_report_job_status_created ON ${q('integration_report_job')} (status, created_at)`,
    );
    await queryRunner.query(`
      CREATE TABLE ${q('integration_report_row_error')} (
        id uuid PRIMARY KEY,
        report_job_id uuid NOT NULL REFERENCES ${q('integration_report_job')}(id) ON DELETE CASCADE,
        row_number integer NOT NULL CHECK (row_number > 0),
        source_key varchar(255),
        error_code varchar(100) NOT NULL,
        redacted_detail text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_integration_report_row_error UNIQUE (report_job_id, row_number)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${q('integration_notification')} (
        id uuid PRIMARY KEY,
        dedup_key varchar(512) NOT NULL UNIQUE,
        type varchar(100) NOT NULL,
        recipient_id uuid,
        channel varchar(32) NOT NULL DEFAULT 'in_app',
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(24) NOT NULL DEFAULT 'pending',
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_integration_notification_recipient_created ON ${q('integration_notification')} (recipient_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_integration_configuration_deployment_identity ON ${q('integration_configuration')} (config_key) WHERE config_key = 'deployment_identity'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    const q = (name: string) => table(schema, name);
    for (const name of [
      'integration_notification',
      'integration_report_row_error',
      'integration_report_job',
      'integration_campaign_daily',
      'integration_aggregate_lease',
      'integration_outbox',
      'integration_operation',
      'integration_audit_event',
      'integration_assignment_cursor',
      'integration_deal_history',
      'integration_deal',
      'integration_submission',
      'integration_lead_identity',
      'integration_lead',
      'integration_webhook_event',
    ]) {
      await queryRunner.query(`DROP TABLE ${q(name)}`);
    }
    await queryRunner.query(
      `DROP INDEX ${table(schema, 'uq_integration_configuration_deployment_identity')}`,
    );
  }
}
