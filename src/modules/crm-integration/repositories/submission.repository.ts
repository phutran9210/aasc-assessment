import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { SubmissionEntity } from '../entities/submission.entity.js';

@Injectable()
export class SubmissionRepository {
  create(input: DeepPartial<SubmissionEntity>, manager: EntityManager): SubmissionEntity {
    return manager.getRepository(SubmissionEntity).create(input);
  }

  save(submission: SubmissionEntity, manager: EntityManager): Promise<SubmissionEntity> {
    return manager.getRepository(SubmissionEntity).save(submission);
  }

  findByKey(
    advertiserId: string,
    providerMode: 'mock' | 'business-api',
    submissionKey: string,
    manager: EntityManager,
  ): Promise<SubmissionEntity | null> {
    return manager.getRepository(SubmissionEntity).findOne({
      where: { advertiserId, providerMode, submissionKey },
    });
  }

  findLatestForLead(leadId: string, manager: EntityManager): Promise<SubmissionEntity | null> {
    return manager
      .getRepository(SubmissionEntity)
      .findOne({ where: { leadId }, order: { occurredAt: 'DESC' } });
  }

  findLatestByProviderLeadId(
    advertiserId: string,
    providerMode: 'mock' | 'business-api',
    providerLeadId: string,
    manager: EntityManager,
    associationStatus?: SubmissionEntity['associationStatus'],
  ): Promise<SubmissionEntity | null> {
    return manager.getRepository(SubmissionEntity).findOne({
      where: {
        advertiserId,
        providerMode,
        providerLeadId,
        ...(associationStatus ? { associationStatus } : {}),
      },
      order: { occurredAt: 'DESC' },
    });
  }

  findForLead(leadId: string, manager: EntityManager): Promise<SubmissionEntity[]> {
    return manager.getRepository(SubmissionEntity).find({ where: { leadId } });
  }
}
