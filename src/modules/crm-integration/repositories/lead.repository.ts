import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { LeadEntity } from '../entities/lead.entity.js';

@Injectable()
export class LeadRepository {
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
}
