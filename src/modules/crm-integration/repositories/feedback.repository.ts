import { Injectable } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { LeadEntity } from '../entities/lead.entity.js';
import { SubmissionEntity } from '../entities/submission.entity.js';
import { FeedbackLedgerEntity } from '../entities/feedback-ledger.entity.js';

@Injectable()
export class FeedbackRepository {
  async findLeadContext(leadId: string, manager: EntityManager) {
    const lead = await manager.getRepository(LeadEntity).findOne({ where: { id: leadId } });
    if (!lead) return { lead: null, submission: null };
    // Interaction submissions never carry a consent answer, so the newest one that does decides.
    // A later lead form that withdraws consent therefore still wins.
    const submission = await manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder('submission')
      .where('submission.leadId = :leadId', { leadId })
      .orderBy("jsonb_exists(submission.consent, 'crm_feedback_allowed')", 'DESC')
      .addOrderBy('submission.occurredAt', 'DESC')
      .addOrderBy('submission.id', 'DESC')
      .getOne();
    return { lead, submission };
  }

  async ensureLedger(input: QueryDeepPartialEntity<FeedbackLedgerEntity>, manager: EntityManager) {
    const repository = manager.getRepository(FeedbackLedgerEntity);
    await repository.createQueryBuilder().insert().values(input).orIgnore().execute();
  }

  findForUpdate(
    advertiserId: string,
    leadId: string,
    milestone: FeedbackLedgerEntity['milestone'],
    manager: EntityManager,
  ): Promise<FeedbackLedgerEntity | null> {
    return manager.getRepository(FeedbackLedgerEntity).findOne({
      where: { advertiserId, leadId, milestone },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findById(id: string, manager: EntityManager): Promise<FeedbackLedgerEntity | null> {
    return manager.getRepository(FeedbackLedgerEntity).findOne({ where: { id } });
  }

  update(
    id: string,
    patch: QueryDeepPartialEntity<FeedbackLedgerEntity>,
    manager: EntityManager,
  ): Promise<unknown> {
    return manager.getRepository(FeedbackLedgerEntity).update(id, patch);
  }

  save(ledger: FeedbackLedgerEntity, manager: EntityManager): Promise<FeedbackLedgerEntity> {
    return manager.getRepository(FeedbackLedgerEntity).save(ledger);
  }
}
