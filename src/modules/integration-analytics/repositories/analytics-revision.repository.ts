import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AnalyticsRevisionEntity } from '../entities/analytics-revision.entity.js';

const ANALYTICS_REVISION_ID = '00000000-0000-7000-8000-000000000001';

@Injectable()
export class AnalyticsRevisionRepository {
  async increment(manager: EntityManager): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(AnalyticsRevisionEntity)
      .set({ revision: () => 'revision + 1' })
      .where('id = :id', { id: ANALYTICS_REVISION_ID })
      .execute();
  }
}
