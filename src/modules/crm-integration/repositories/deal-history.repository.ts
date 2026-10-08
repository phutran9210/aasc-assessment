import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { DealHistoryEntity } from '../entities/deal-history.entity.js';

export type DealHistoryInput = Pick<
  DealHistoryEntity,
  | 'dealId'
  | 'previousStageId'
  | 'currentStageId'
  | 'previousSemantics'
  | 'currentSemantics'
  | 'amount'
  | 'currency'
  | 'providerRevisionKey'
  | 'observedAt'
  | 'effectiveAt'
  | 'sourceComplete'
>;

@Injectable()
export class DealHistoryRepository {
  async record(input: DealHistoryInput, manager: EntityManager): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(DealHistoryEntity)
      .values({ id: uuidv7(), ...input })
      .orIgnore()
      .returning(['id'])
      .execute();
    const rows = Array.isArray(result.raw) ? result.raw : [];
    return rows.length > 0;
  }
}
