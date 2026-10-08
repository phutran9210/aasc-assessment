import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '@/apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.lead })
@Index('uq_integration_lead_external_id', ['externalId'], { unique: true })
@Index('uq_integration_lead_portal_remote_id', ['portalKey', 'bitrixLeadId'], { unique: true })
@Index('ix_integration_lead_sync_updated', ['syncStatus', 'updatedAt'])
@Index('ix_integration_lead_advertiser_created', ['advertiserId', 'createdAt', 'id'])
export class LeadEntity extends IntegrationBaseEntity {
  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ name: 'advertiser_id', type: 'varchar', length: 255 })
  advertiserId!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 255 })
  scopeKey!: string;

  @Column({ name: 'portal_key', type: 'varchar', length: 128 })
  portalKey!: string;

  @Column({ name: 'provider_mode', type: 'varchar', length: 20 })
  providerMode!: 'mock' | 'business-api';

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  city!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  interests!: string[];

  @Column({ type: 'integer', default: 0 })
  score!: number;

  @Column({ name: 'score_version', type: 'integer', default: 1 })
  scoreVersion!: number;

  @Column({ name: 'score_breakdown', type: 'jsonb', default: () => "'{}'::jsonb" })
  scoreBreakdown!: Record<string, number>;

  @Column({ name: 'business_status', type: 'varchar', length: 24, default: 'new' })
  businessStatus!: string;

  @Column({ name: 'sync_status', type: 'varchar', length: 24, default: 'pending' })
  syncStatus!: string;

  @Column({ name: 'bitrix_lead_id', type: 'varchar', length: 255, nullable: true })
  bitrixLeadId!: string | null;

  @Column({ name: 'first_submission_id', type: 'uuid', nullable: true })
  firstSubmissionId!: string | null;

  @Column({ name: 'last_submission_id', type: 'uuid', nullable: true })
  lastSubmissionId!: string | null;

  @Column({ name: 'first_touch_at', type: 'timestamptz' })
  firstTouchAt!: Date;

  @Column({ name: 'first_touch_campaign_id', type: 'varchar', length: 255, nullable: true })
  firstTouchCampaignId!: string | null;

  @Column({ name: 'last_touch_at', type: 'timestamptz', nullable: true })
  lastTouchAt!: Date | null;

  @Column({ name: 'converted_at', type: 'timestamptz', nullable: true })
  convertedAt!: Date | null;

  @Column({ name: 'deal_created_at', type: 'timestamptz', nullable: true })
  dealCreatedAt!: Date | null;

  @Column({ name: 'field_provenance', type: 'jsonb', default: () => "'{}'::jsonb" })
  fieldProvenance!: Record<string, unknown>;

  @Column({ name: 'last_written_fields', type: 'jsonb', default: () => "'{}'::jsonb" })
  lastWrittenFields!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;
}
