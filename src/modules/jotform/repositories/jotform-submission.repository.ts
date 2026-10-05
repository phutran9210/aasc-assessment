import { nowDate, nowMs } from '@common/utils/index.js';
import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { JOTFORM_ERROR_MAX_LENGTH, JOTFORM_SUBMISSION_STATUS } from '../constants/index.js';
import { JotformSubmission } from '../entities/jotform-submission.entity.js';

const { PROCESSING, SYNCED, FAILED, INVALID } = JOTFORM_SUBMISSION_STATUS;

/**
 * claimed: the caller owns the submission and must finish with markSynced or markFailed.
 * synced: the contact already exists; nothing to do.
 * busy: another request is creating the contact right now.
 */
export type JotformClaim = {
  outcome: 'claimed' | 'synced' | 'busy';
  record: JotformSubmission;
};

@Injectable()
export class JotformSubmissionRepository extends BaseRepository<JotformSubmission> {
  constructor(dataSource: DataSource) {
    super(dataSource, JotformSubmission);
  }

  /**
   * Decides who may create the contact for a submission. Two atomic statements make this safe
   * for duplicate webhook deliveries, concurrent requests and several processes:
   * an INSERT that does nothing when the row exists, then an UPDATE that takes over a row
   * only if it failed before or its owner went silent for `staleMs`. Whoever ends up with
   * their own token in the row is the owner.
   */
  async claim(submissionId: string, formId: string, staleMs: number): Promise<JotformClaim> {
    const claimToken = uuidv7();
    const now = nowMs();

    await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        id: uuidv7(),
        submissionId,
        formId,
        status: PROCESSING,
        claimToken,
        processingStartedAt: now,
      })
      .orIgnore()
      .execute();

    await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: PROCESSING, claimToken, processingStartedAt: now, error: null })
      .where('submissionId = :submissionId AND claimToken != :claimToken', {
        submissionId,
        claimToken,
      })
      .andWhere(
        '(status IN (:...retryable) OR (status = :processing AND processingStartedAt <= :staleBefore))',
        { retryable: [FAILED, INVALID], processing: PROCESSING, staleBefore: now - staleMs },
      )
      .execute();

    const record = await this.repo.findOneByOrFail({ submissionId });
    if (record.claimToken === claimToken) return { outcome: 'claimed', record };
    return { outcome: record.status === SYNCED ? 'synced' : 'busy', record };
  }

  async markSynced(id: string, contactId: string): Promise<void> {
    await this.repo.update(
      { id },
      { status: SYNCED, bitrixContactId: contactId, error: null, syncedAt: nowDate() },
    );
  }

  /** FAILED = worth retrying as is; INVALID = the submitted data has to change first. */
  async markFailed(
    id: string,
    status: typeof FAILED | typeof INVALID,
    error: string,
  ): Promise<void> {
    await this.repo.update({ id }, { status, error: error.slice(0, JOTFORM_ERROR_MAX_LENGTH) });
  }
}
