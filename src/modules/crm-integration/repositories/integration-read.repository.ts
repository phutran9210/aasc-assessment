import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type { DealQueryDto } from '../dto/deal-query.dto.js';
import type { LeadQueryDto } from '../dto/lead-query.dto.js';
import type { OperationQueryDto } from '../dto/operation-query.dto.js';
import { DealEntity } from '../entities/deal.entity.js';
import { LeadEntity } from '../entities/lead.entity.js';

@Injectable()
export class IntegrationReadRepository {
  constructor(@InjectDataSource('tiktok') private readonly dataSource: DataSource) {}

  async listLeads(query: LeadQueryDto): Promise<[LeadEntity[], number]> {
    const builder = this.dataSource.getRepository(LeadEntity).createQueryBuilder('lead');
    if (query.campaign_id) {
      builder.andWhere('lead.firstTouchCampaignId = :campaignId', {
        campaignId: query.campaign_id,
      });
    }
    if (query.sync_status)
      builder.andWhere('lead.syncStatus = :syncStatus', { syncStatus: query.sync_status });
    if (query.business_status)
      builder.andWhere('lead.businessStatus = :businessStatus', {
        businessStatus: query.business_status,
      });
    if (query.from) builder.andWhere('lead.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) builder.andWhere('lead.createdAt <= :to', { to: new Date(query.to) });
    return builder
      .orderBy('lead.createdAt', 'DESC')
      .addOrderBy('lead.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
  }

  async listDeals(query: DealQueryDto): Promise<[DealEntity[], number]> {
    const builder = this.dataSource.getRepository(DealEntity).createQueryBuilder('deal');
    if (query.status) builder.andWhere('deal.stageSemantics = :status', { status: query.status });
    if (query.assigned_to)
      builder.andWhere('deal.assignedTo = :assignedTo', { assignedTo: query.assigned_to });
    return builder
      .orderBy('deal.createdAt', 'DESC')
      .addOrderBy('deal.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
  }

  getOperation(id: string): Promise<OperationEntity | null> {
    return this.dataSource.getRepository(OperationEntity).findOne({ where: { id } });
  }

  listOperations(query: OperationQueryDto): Promise<[OperationEntity[], number]> {
    const builder = this.dataSource.getRepository(OperationEntity).createQueryBuilder('operation');
    if (query.status) builder.andWhere('operation.status = :status', { status: query.status });
    return builder
      .orderBy('operation.updatedAt', 'DESC')
      .addOrderBy('operation.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
  }
}
