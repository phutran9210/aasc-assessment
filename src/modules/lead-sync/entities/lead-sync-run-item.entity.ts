import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import type { RunItemAction } from '../constants/index.js';

/** One row per Sheet row a run created, updated or failed. Skipped rows are only counted. */
@Entity(TABLE_NAMES.LEAD_SYNC_RUN_ITEM)
@Index('ix_lead_sync_run_item_run_id', ['runId'])
export class LeadSyncRunItem extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  runId: string;

  @Column({ type: 'integer' })
  rowNumber: number;

  @Column({ type: 'varchar', length: 16 })
  action: RunItemAction;

  @Column({ type: 'varchar', length: 32, nullable: true })
  leadId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'integer', default: 1 })
  attempts: number;
}
