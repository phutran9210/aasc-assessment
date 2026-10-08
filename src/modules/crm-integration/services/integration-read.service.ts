import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { Actor } from '@modules/integration-auth/types/index.js';
import type { DealQueryDto } from '../dto/deal-query.dto.js';
import type { LeadQueryDto } from '../dto/lead-query.dto.js';
import type { OperationQueryDto } from '../dto/operation-query.dto.js';
import type { DealDto, LeadDto, OperationDto, Page } from '../dto/integration-response.dto.js';
import { DealEntity } from '../entities/deal.entity.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { IntegrationReadRepository } from '../repositories/integration-read.repository.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';

@Injectable()
export class IntegrationReadService {
  constructor(private readonly repository: IntegrationReadRepository) {}

  async listLeads(
    query: LeadQueryDto,
    actor: Actor,
  ): Promise<Page<LeadDto> & { timeBasis: 'createdAt' }> {
    void actor;
    validateRange(query.from, query.to);
    if (query.source !== 'tiktok') throw new BadRequestException('Unsupported lead source');
    const [rows, total] = await this.repository.listLeads(query);
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
    const [rows, total] = await this.repository.listDeals(query);
    return { items: rows.map(toDealDto), total, page: query.page, limit: query.limit };
  }

  async getOperation(id: string, actor: Actor): Promise<OperationDto> {
    void actor;
    const operation = await this.repository.getOperation(id);
    if (!operation) throw new NotFoundException('Operation was not found');
    return toOperationDto(operation);
  }

  async listOperations(query: OperationQueryDto, actor: Actor): Promise<Page<OperationDto>> {
    void actor;
    const [rows, total] = await this.repository.listOperations(query);
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
