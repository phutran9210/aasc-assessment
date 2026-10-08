import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { SubmissionEntity } from '../entities/submission.entity.js';

@Injectable()
export class SubmissionRepository {
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
}
