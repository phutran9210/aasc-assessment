import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { LeadEntity } from '../entities/lead.entity.js';

@Injectable()
export class LeadRepository {
  create(input: DeepPartial<LeadEntity>, manager: EntityManager): LeadEntity {
    return manager.getRepository(LeadEntity).create(input);
  }

  async withIdentityLocks<T>(
    keys: string[],
    callback: () => Promise<T>,
    manager: EntityManager,
  ): Promise<T> {
    for (const key of [...new Set(keys)].sort()) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    }
    return callback();
  }

  findById(id: string, manager: EntityManager): Promise<LeadEntity | null> {
    return manager.getRepository(LeadEntity).findOne({ where: { id } });
  }

  findByIdForUpdate(id: string, manager: EntityManager): Promise<LeadEntity | null> {
    return manager
      .getRepository(LeadEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  save(lead: LeadEntity, manager: EntityManager): Promise<LeadEntity> {
    return manager.getRepository(LeadEntity).save(lead);
  }

  update(
    id: string,
    values: QueryDeepPartialEntity<LeadEntity>,
    manager: EntityManager,
  ): Promise<unknown> {
    return manager.getRepository(LeadEntity).update(id, values);
  }
}
