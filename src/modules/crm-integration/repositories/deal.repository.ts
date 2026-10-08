import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';

import { DealEntity } from '../entities/deal.entity.js';

@Injectable()
export class DealRepository {
  constructor(@InjectDataSource('tiktok') private readonly dataSource: DataSource) {}

  findByLead(leadId: string, manager: EntityManager = this.dataSource.manager) {
    return manager.getRepository(DealEntity).findOne({ where: { leadId } });
  }
}
