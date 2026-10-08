import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { TimelineEntity } from '../entities/timeline.entity.js';

@Injectable()
export class TimelineRepository {
  findById(id: string, manager: EntityManager): Promise<TimelineEntity | null> {
    return manager.getRepository(TimelineEntity).findOne({ where: { id } });
  }

  findByMarker(marker: string, manager: EntityManager): Promise<TimelineEntity | null> {
    return manager.getRepository(TimelineEntity).findOne({ where: { marker } });
  }

  findByIdForUpdate(id: string, manager: EntityManager): Promise<TimelineEntity | null> {
    return manager
      .getRepository(TimelineEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  save(timeline: DeepPartial<TimelineEntity>, manager: EntityManager): Promise<TimelineEntity> {
    return manager.getRepository(TimelineEntity).save(timeline);
  }

  update(id: string, patch: Partial<TimelineEntity>, manager: EntityManager): Promise<unknown> {
    return manager.getRepository(TimelineEntity).update(id, patch);
  }
}
