import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '@/apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '@/apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.deal })
@Index('uq_integration_deal_lead', ['leadId'], { unique: true })
@Index('uq_integration_deal_remote_id', ['portalKey', 'bitrixDealId'], { unique: true })
@Index('ix_integration_deal_stage_assignee', ['stageSemantics', 'assignedTo', 'createdAt'])
export class DealEntity extends IntegrationBaseEntity {
  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'portal_key', type: 'varchar', length: 128 })
  portalKey!: string;

  @Column({ name: 'bitrix_deal_id', type: 'varchar', length: 255, nullable: true })
  bitrixDealId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'numeric', precision: 20, scale: 4, nullable: true })
  amount!: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'pipeline_id', type: 'varchar', length: 255 })
  pipelineId!: string;

  @Column({ name: 'stage_id', type: 'varchar', length: 255 })
  stageId!: string;

  @Column({ name: 'stage_semantics', type: 'varchar', length: 16, default: 'open' })
  stageSemantics!: 'open' | 'won' | 'lost';

  @Column({ name: 'stage_deleted_at', type: 'timestamptz', nullable: true })
  stageDeletedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  probability!: number;

  @Column({ name: 'assigned_to', type: 'varchar', length: 255, nullable: true })
  assignedTo!: string | null;

  @Column({ name: 'rule_revision', type: 'integer' })
  ruleRevision!: number;

  @Column({ name: 'conversion_status', type: 'varchar', length: 32, default: 'pending' })
  conversionStatus!: string;

  @Column({ name: 'remote_modified_at', type: 'timestamptz', nullable: true })
  remoteModifiedAt!: Date | null;

  @Column({ name: 'ever_won_at', type: 'timestamptz', nullable: true })
  everWonAt!: Date | null;

  @Column({ name: 'current_snapshot_hash', type: 'varchar', length: 64, nullable: true })
  currentSnapshotHash!: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;
}
