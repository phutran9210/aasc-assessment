import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import type { LeadSyncRunStatus, LeadSyncTrigger } from '../constants/index.js';

/**
 * One row per sync run: who started it, how it ended and how many rows it touched. The row with
 * status `running` is also the lock: the partial unique index allows only one at a time, across
 * processes (server, CLI) that share the database file.
 */
@Entity(TABLE_NAMES.LEAD_SYNC_RUN)
@Index('uq_lead_sync_run_running', ['status'], { unique: true, where: `"status" = 'running'` })
export class LeadSyncRun extends BaseEntity {
  @Column({ type: 'varchar', length: 16 })
  trigger: LeadSyncTrigger;

  @Column({ type: 'varchar', length: 16 })
  status: LeadSyncRunStatus;

  @Column({ type: 'boolean', default: false })
  dryRun: boolean;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  total: number;

  @Column({ type: 'integer', default: 0 })
  created: number;

  @Column({ type: 'integer', default: 0 })
  updated: number;

  @Column({ type: 'integer', default: 0 })
  skipped: number;

  @Column({ type: 'integer', default: 0 })
  failed: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  stopReason: string | null;

  /** Epoch milliseconds of the last sign of life; a running row older than the lease is dead. */
  @Column({ type: 'integer' })
  heartbeatAt: number;
}
