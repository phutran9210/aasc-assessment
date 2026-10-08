import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import type { Actor } from '@modules/integration-auth/types/index.js';
import type { DealQueryDto } from '../dto/deal-query.dto.js';
import type { LeadQueryDto } from '../dto/lead-query.dto.js';
import type { OperationQueryDto } from '../dto/operation-query.dto.js';
import type { DealDto, LeadDto, OperationDto, Page } from '../dto/integration-response.dto.js';
import { DealEntity } from '../entities/deal.entity.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';

@Injectable()
export class IntegrationReadService {
  constructor(@InjectDataSource('tiktok') private readonly dataSource: DataSource) {}

  async listLeads(
    query: LeadQueryDto,
    actor: Actor,
  ): Promise<Page<LeadDto> & { timeBasis: 'createdAt' }> {
    void actor;
    validateRange(query.from, query.to);
    const repository = this.dataSource.getRepository(LeadEntity);
    const builder = repository.createQueryBuilder('lead');
    if (query.source !== 'tiktok') throw new BadRequestException('Unsupported lead source');
    if (query.campaign_id)
      builder.andWhere('lead.firstTouchCampaignId = :campaignId', {
        campaignId: query.campaign_id,
      });
    if (query.sync_status)
      builder.andWhere('lead.syncStatus = :syncStatus', { syncStatus: query.sync_status });
    if (query.business_status)
      builder.andWhere('lead.businessStatus = :businessStatus', {
        businessStatus: query.business_status,
      });
    if (query.from) builder.andWhere('lead.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) builder.andWhere('lead.createdAt <= :to', { to: new Date(query.to) });
    const [rows, total] = await builder
      .orderBy('lead.createdAt', 'DESC')
      .addOrderBy('lead.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: rows.map(toLeadDto),
      total,
      page: query.page,
      limit: query.limit,
      timeBasis: 'createdAt',
    };
  }

  async listDeals(query: DealQueryDto, actor: Actor): Promise<Page<DealDto>> {
    void actor;
    const builder = this.dataSource.getRepository(DealEntity).createQueryBuilder('deal');
    if (query.status) builder.andWhere('deal.stageSemantics = :status', { status: query.status });
    if (query.assigned_to)
      builder.andWhere('deal.assignedTo = :assignedTo', { assignedTo: query.assigned_to });
    const [rows, total] = await builder
      .orderBy('deal.createdAt', 'DESC')
      .addOrderBy('deal.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items: rows.map(toDealDto), total, page: query.page, limit: query.limit };
  }

  async getOperation(id: string, actor: Actor): Promise<OperationDto> {
    void actor;
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id } });
    if (!operation) throw new NotFoundException('Operation was not found');
    return toOperationDto(operation);
  }

  async listOperations(query: OperationQueryDto, actor: Actor): Promise<Page<OperationDto>> {
    void actor;
    const builder = this.dataSource.getRepository(OperationEntity).createQueryBuilder('operation');
    if (query.status) builder.andWhere('operation.status = :status', { status: query.status });
    const [rows, total] = await builder
      .orderBy('operation.updatedAt', 'DESC')
      .addOrderBy('operation.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items: rows.map(toOperationDto), total, page: query.page, limit: query.limit };
  }
}

function validateRange(from?: string, to?: string): void {
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new BadRequestException('from must be earlier than or equal to to');
  }
}

function toLeadDto(lead: LeadEntity): LeadDto {
  return {
    id: lead.id,
    externalId: lead.externalId,
    source: 'tiktok',
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    campaignId: lead.firstTouchCampaignId,
    createdAt: lead.createdAt.toISOString(),
    firstTouchAt: lead.firstTouchAt.toISOString(),
    score: lead.score,
    scoreBreakdown: lead.scoreBreakdown,
    businessStatus: lead.businessStatus,
    syncStatus: lead.syncStatus,
    bitrixLeadId: lead.bitrixLeadId,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    lastErrorCode: lead.lastErrorCode,
  };
}

function toDealDto(deal: DealEntity): DealDto {
  return {
    id: deal.id,
    leadId: deal.leadId,
    bitrixDealId: deal.bitrixDealId,
    title: deal.title,
    amount: deal.amount,
    currency: deal.currency,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    stageSemantics: deal.stageSemantics,
    probability: deal.probability,
    assignedTo: deal.assignedTo,
    conversionStatus: deal.conversionStatus,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

export function toOperationDto(operation: OperationEntity): OperationDto {
  return {
    id: operation.id,
    kind: operation.kind,
    aggregateId: operation.aggregateId,
    targetVersion: operation.targetVersion,
    status: operation.status,
    attempt: operation.attempt,
    step: operation.status === 'processing' ? 'processing' : operation.status,
    remoteId: operation.remoteId,
    errorCode: operation.lastErrorCode,
    nextAttemptAt: operation.nextAttemptAt?.toISOString() ?? null,
    configRevisions: operation.configRevisions,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
  };
}
