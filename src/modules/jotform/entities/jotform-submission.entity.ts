import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import type { JotformSubmissionStatus } from '../constants/index.js';

/**
 * One row per Jotform submission ever received. It prevents creating the same contact twice
 * and doubles as the integration log: when it arrived, how it ended, and why it failed.
 */
@Entity(TABLE_NAMES.JOTFORM_SUBMISSION)
@Index('uq_jotform_submission_submission_id', ['submissionId'], { unique: true })
export class JotformSubmission extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  submissionId: string;

  @Column({ type: 'varchar', length: 32 })
  formId: string;

  @Column({ type: 'varchar', length: 20 })
  status: JotformSubmissionStatus;

  /** Identifies the request that currently owns the row; see JotformSubmissionRepository.claim. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  claimToken: string | null;

  /** Epoch milliseconds of the latest claim. */
  @Column({ type: 'integer' })
  processingStartedAt: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  bitrixContactId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @Column({ type: 'datetime', nullable: true })
  syncedAt: Date | null;
}
