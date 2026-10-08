import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.submission })
@Index('uq_integration_submission_key', ['advertiserId', 'providerMode', 'submissionKey'], {
  unique: true,
})
@Index('ix_integration_submission_campaign_time', ['advertiserId', 'campaignId', 'occurredAt'])
export class SubmissionEntity extends IntegrationBaseEntity {
  @Column({ name: 'advertiser_id', type: 'varchar', length: 255 })
  advertiserId!: string;

  @Column({ name: 'provider_mode', type: 'varchar', length: 20 })
  providerMode!: 'mock' | 'business-api';

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId!: string | null;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'provider_lead_id', type: 'varchar', length: 255, nullable: true })
  providerLeadId!: string | null;

  @Column({ name: 'submission_key', type: 'varchar', length: 255 })
  submissionKey!: string;

  @Column({ name: 'campaign_id', type: 'varchar', length: 255, nullable: true })
  campaignId!: string | null;

  @Column({ name: 'campaign_name', type: 'varchar', length: 255, nullable: true })
  campaignName!: string | null;

  @Column({ name: 'ad_id', type: 'varchar', length: 255, nullable: true })
  adId!: string | null;

  @Column({ name: 'ad_name', type: 'varchar', length: 255, nullable: true })
  adName!: string | null;

  @Column({ name: 'form_id', type: 'varchar', length: 255, nullable: true })
  formId!: string | null;

  @Column({ name: 'form_name', type: 'varchar', length: 255, nullable: true })
  formName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ttclid!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  utm!: Record<string, string>;

  @Column({ name: 'custom_answers', type: 'jsonb', default: () => "'{}'::jsonb" })
  customAnswers!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  engagement!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  consent!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'is_historical', type: 'boolean', default: false })
  isHistorical!: boolean;

  @Column({ name: 'apply_rules', type: 'boolean', default: true })
  applyRules!: boolean;

  @Column({ name: 'send_feedback', type: 'boolean', default: true })
  sendFeedback!: boolean;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;
}
