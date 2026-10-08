import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { AuditEventEntity } from '../entities/audit-event.entity.js';

@Injectable()
export class AuditEventRepository {
  record(input: DeepPartial<AuditEventEntity>, manager: EntityManager): Promise<AuditEventEntity> {
    return manager.getRepository(AuditEventEntity).save(input);
  }
}
