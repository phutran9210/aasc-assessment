import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { DealEntity } from '../entities/deal.entity.js';

@Injectable()
export class DealRepository {
  constructor(@InjectDataSource('tiktok') private readonly dataSource: DataSource) {}

  findByLead(leadId: string, manager: EntityManager = this.dataSource.manager) {
    return manager.getRepository(DealEntity).findOne({ where: { leadId } });
  }

  findById(id: string, manager: EntityManager = this.dataSource.manager) {
    return manager.getRepository(DealEntity).findOne({ where: { id } });
  }

  findByPortalRemote(
    portalKey: string,
    remoteId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    return manager
      .getRepository(DealEntity)
      .findOne({ where: { portalKey, bitrixDealId: remoteId } });
  }

  findByIdForUpdate(id: string, manager: EntityManager) {
    return manager
      .getRepository(DealEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  save(deal: DealEntity, manager: EntityManager) {
    return manager.getRepository(DealEntity).save(deal);
  }

  update(id: string, values: QueryDeepPartialEntity<DealEntity>, manager: EntityManager) {
    return manager.getRepository(DealEntity).update(id, values);
  }
}
