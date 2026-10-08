import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.dealHistory })
@Index('uq_integration_deal_history_revision', ['dealId', 'providerRevisionKey'], { unique: true })
@Index('ix_integration_deal_history_effective', ['dealId', 'effectiveAt'])
export class DealHistoryEntity extends IntegrationBaseEntity {
  @Column({ name: 'deal_id', type: 'uuid' })
  dealId!: string;

  @Column({ name: 'previous_stage_id', type: 'varchar', length: 255, nullable: true })
  previousStageId!: string | null;

  @Column({ name: 'current_stage_id', type: 'varchar', length: 255 })
  currentStageId!: string;

  @Column({ name: 'previous_semantics', type: 'varchar', length: 16, nullable: true })
  previousSemantics!: string | null;

  @Column({ name: 'current_semantics', type: 'varchar', length: 16 })
  currentSemantics!: string;

  @Column({ type: 'numeric', precision: 20, scale: 4, nullable: true })
  amount!: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'provider_revision_key', type: 'varchar', length: 255 })
  providerRevisionKey!: string;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @Column({ name: 'effective_at', type: 'timestamptz' })
  effectiveAt!: Date;

  @Column({ name: 'source_complete', type: 'boolean', default: true })
  sourceComplete!: boolean;
}
