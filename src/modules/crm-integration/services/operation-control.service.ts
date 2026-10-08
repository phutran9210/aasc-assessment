import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { QUEUE_NAMES, retryQueueForOperation } from '@core/queue/constants/operation.constants.js';
import type { QueueName } from '@core/queue/types/operation.types.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import type { LeadIdentityEntity } from '../entities/lead-identity.entity.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';
import { LeadRepository } from '../repositories/lead.repository.js';
import { DealRepository } from '../repositories/deal.repository.js';
import { LeadIdentityRepository } from '../repositories/lead-identity.repository.js';
import { AuditEventRepository } from '../repositories/audit-event.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import type { CrmGateway } from '../ports/crm-gateway.port.js';
import { RemoteReconciliationService } from './remote-reconciliation.service.js';
import type { OperationResolveDto } from '../dto/operation-resolve.dto.js';
import type { OperationDto } from '../dto/integration-response.dto.js';
import { toOperationDto } from './integration-read.service.js';
import { ACTIVE_OPERATION_STATUSES } from '../constants/flow.constants.js';

@Injectable()
export class OperationControlService {
  constructor(
    @InjectDataSource('tiktok') private readonly dataSource: DataSource,
    private readonly outbox: OutboxRepository,
    private readonly operations: OperationRepository,
    private readonly leads: LeadRepository,
    private readonly deals: DealRepository,
    private readonly configurations: ConfigurationRepository,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly reconciliation: RemoteReconciliationService,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly identities: LeadIdentityRepository,
    private readonly auditEvents: AuditEventRepository,
  ) {}

  async retry(id: string, reason: string, actor: Actor): Promise<OperationDto> {
    if (!reason?.trim()) throw new ConflictException('A reason is required');
    return this.dataSource.transaction(async (manager) => {
      const operation = await this.operations.findByIdForUpdate(id, manager);
      if (!operation) throw new NotFoundException('Operation was not found');
      if (ACTIVE_OPERATION_STATUSES.has(operation.status))
        throw new ConflictException('Operation is active');
      if (operation.status !== 'dead_letter')
        throw new ConflictException('Resolve the operation before retrying it');
      if (operation.aggregateId)
        await this.assertNoActiveAggregateOperation(manager, operation.id, operation.aggregateId);
      const queue = queueFor(operation.kind);
      const before = auditState(operation);
      operation.status = 'pending';
      operation.nextAttemptAt = null;
      operation.leaseUntil = null;
      operation.leaseToken = null;
      await this.operations.save(operation, manager);
      await this.outbox.append(operation.id, queue, new Date(), manager);
      await this.audit(
        manager,
        operation,
        actor,
        'operation.retry_requested',
        before,
        auditState(operation),
        reason,
      );
      return toOperationDto(operation);
    });
  }

  async resolve(id: string, input: OperationResolveDto, actor: Actor): Promise<OperationDto> {
    const snapshot = await this.operations.findById(id, this.dataSource.manager);
    if (!snapshot) throw new NotFoundException('Operation was not found');
    if (ACTIVE_OPERATION_STATUSES.has(snapshot.status))
      throw new ConflictException('Operation is active');
    if (!['reconcile_required', 'quarantined', 'dead_letter'].includes(snapshot.status))
      throw new ConflictException('Operation does not require resolution');

    if (input.action === 'link_remote') {
      if (!input.remoteId) throw new ConflictException('remoteId is required');
      await this.verifyRemote(snapshot, input.remoteId);
    }

    if (input.action === 'confirm_remote_absent') await this.verifyRemoteAbsent(snapshot);

    if (input.action === 'select_identity_target') {
      if (!input.targetLeadId) throw new ConflictException('targetLeadId is required');
      if (!input.identityTargets || !Object.keys(input.identityTargets).length)
        throw new ConflictException('identityTargets are required');
    }

    if (input.action === 'select_identity_target') {
      return this.reprocessIdentityTarget(snapshot, input, actor);
    }

    if (
      input.action === 'reprocess_with_current_config' ||
      input.action === 'confirm_remote_absent'
    ) {
      return this.createReprocess(snapshot, input, actor);
    }

    return this.dataSource.transaction(async (manager) => {
      const operation = await this.operations.findByIdForUpdate(id, manager);
      if (!operation || ACTIVE_OPERATION_STATUSES.has(operation.status))
        throw new ConflictException('Operation state changed during resolution');
      const before = auditState(operation);

      if (input.action === 'link_remote') {
        if (!input.remoteId) throw new ConflictException('remoteId is required');
        await this.linkRemote(manager, operation, input.remoteId);
      }
      operation.status = 'succeeded';
      operation.remoteId =
        input.action === 'link_remote' && input.remoteId ? input.remoteId : operation.remoteId;
      operation.lastErrorCode = null;
      operation.lastErrorDetail = null;
      operation.nextAttemptAt = null;
      operation.completedAt = new Date();
      operation.leaseUntil = null;
      operation.leaseToken = null;
      await this.operations.save(operation, manager);
      await this.audit(
        manager,
        operation,
        actor,
        `operation.resolved.${input.action}`,
        before,
        auditState(operation),
        input.reason,
      );
      return toOperationDto(operation);
    });
  }

  private async createReprocess(
    snapshot: OperationEntity,
    input: OperationResolveDto,
    actor: Actor,
  ): Promise<OperationDto> {
    return this.dataSource.transaction(async (manager) => {
      const original = await this.operations.findByIdForUpdate(snapshot.id, manager);
      if (!original || ACTIVE_OPERATION_STATUSES.has(original.status))
        throw new ConflictException('Operation state changed during resolution');
      if (original.aggregateId)
        await this.assertNoActiveAggregateOperation(manager, original.id, original.aggregateId);
      const revisions =
        input.action === 'reprocess_with_current_config'
          ? await this.configurations.revisions(manager)
          : original.configRevisions;
      const before = auditState(original);
      let suffix = Math.max(
        1,
        original.attempt + Number(original.payload.reconciliationAttempt ?? 0) + 1,
      );
      let key = `${original.operationKey}/resolution/${suffix}`;
      while (await this.operations.findByKey(key, manager)) {
        suffix += 1;
        key = `${original.operationKey}/resolution/${suffix}`;
      }
      const next = this.operations.create(
        {
          id: uuidv7(),
          operationKey: key,
          kind: original.kind,
          aggregateId: original.aggregateId,
          targetVersion: original.targetVersion,
          status: 'pending',
          attempt: 0,
          leaseUntil: null,
          leaseToken: null,
          remoteId: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          nextAttemptAt: null,
          payload: {
            ...original.payload,
            sourceOperationId: original.id,
            reconciliationAttempt: suffix,
            ...(input.action === 'confirm_remote_absent' ? { remoteAbsenceConfirmed: true } : {}),
          },
          configRevisions: revisions,
          actorId: actor.sub,
          completedAt: null,
        },
        manager,
      );
      const persisted = await this.operations.save(next, manager);
      const aggregateId = original.aggregateId;
      if (original.kind === 'bitrix_deal_convert' && aggregateId) {
        const deal = await this.deals.findByLeadForUpdate(aggregateId, manager);
        if (deal) {
          if (deal.conversionStatus === 'completed')
            throw new ConflictException('Completed conversion cannot be reprocessed');
          if (
            input.action === 'reprocess_with_current_config' &&
            deal.conversionStatus !== 'pending'
          ) {
            throw new ConflictException(
              'Resolve the remote conversion side effect before reprocessing it',
            );
          }
          deal.conversionStatus = 'pending';
          deal.version += 1;
          await this.deals.save(deal, manager);
        }
      }
      if (original.kind === 'bitrix_lead_sync' && aggregateId) {
        const lead = await this.leads.findByIdForUpdate(aggregateId, manager);
        if (lead) {
          if (
            input.action === 'reprocess_with_current_config' &&
            lead.syncStatus === 'reconcile_required'
          ) {
            throw new ConflictException('Confirm remote absence before replaying lead creation');
          }
          lead.syncStatus = 'pending';
          lead.lastErrorCode = null;
          await this.leads.save(lead, manager);
        }
      }
      await this.outbox.append(persisted.id, queueFor(persisted.kind), new Date(), manager);
      await this.audit(
        manager,
        original,
        actor,
        `operation.resolved.${input.action}`,
        before,
        {
          status: original.status,
          reprocessOperationId: persisted.id,
          revisions: persisted.configRevisions,
        },
        input.reason,
      );
      return toOperationDto(persisted);
    });
  }

  private async verifyRemote(operation: OperationEntity, remoteId: string): Promise<void> {
    const leadId = operation.payload.leadId ?? operation.aggregateId;
    const dealId = operation.payload.dealId;
    try {
      if (operation.kind === 'bitrix_lead_sync' || operation.kind === 'tiktok_ingest') {
        const localId = leadId;
        if (!localId) throw new ConflictException('Operation has no lead scope');
        const lead = await this.leads.findById(localId, this.dataSource.manager);
        if (!lead) throw new NotFoundException('Lead was not found');
        const remote = await this.gateway.getLead(remoteId);
        if (remote.marker !== `aasc-tiktok/${lead.id}`)
          throw new ConflictException('Remote lead marker does not match');
      } else if (operation.kind === 'bitrix_deal_convert') {
        if (!dealId) throw new ConflictException('Operation has no deal scope');
        const deal = await this.deals.findById(dealId);
        if (!deal) throw new NotFoundException('Deal was not found');
        const remote = await this.gateway.getDeal(remoteId);
        if (remote.marker !== `aasc-tiktok/deal/${deal.id}`)
          throw new ConflictException('Remote deal marker does not match');
      } else {
        throw new ConflictException('This operation cannot link a remote CRM record');
      }
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      throw new ConflictException('Remote CRM record could not be verified');
    }
  }

  private async verifyRemoteAbsent(operation: OperationEntity): Promise<void> {
    const leadId = operation.payload.leadId ?? operation.aggregateId;
    const dealId = operation.payload.dealId;
    let result: Awaited<ReturnType<RemoteReconciliationService['find']>>;
    if (operation.kind === 'bitrix_deal_convert' && dealId) {
      result = await this.reconciliation.find('deal', `aasc-tiktok/deal/${dealId}`);
    } else if (operation.kind === 'bitrix_lead_sync' && leadId) {
      result = await this.reconciliation.find('lead', `aasc-tiktok/${leadId}`);
    } else {
      throw new ConflictException('This operation cannot confirm remote absence');
    }
    if (result.status !== 'not_found')
      throw new ConflictException('Remote record is present or its absence is ambiguous');
  }

  private async linkRemote(
    manager: EntityManager,
    operation: OperationEntity,
    remoteId: string,
  ): Promise<void> {
    if (operation.kind === 'bitrix_lead_sync' || operation.kind === 'tiktok_ingest') {
      const leadId = operation.payload.leadId ?? operation.aggregateId;
      if (!leadId) throw new ConflictException('Operation has no lead scope');
      const lead = await this.leads.findByIdForUpdate(leadId, manager);
      if (!lead) throw new NotFoundException('Lead was not found');
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `bitrix-lead/${lead.portalKey}/${remoteId}`,
      ]);
      const collision = await this.leads.findByPortalRemote(lead.portalKey, remoteId, manager);
      if (collision && collision.id !== lead.id)
        throw new ConflictException('Remote lead is linked to another local lead');
      lead.bitrixLeadId = remoteId;
      lead.syncStatus = 'synced';
      lead.lastErrorCode = null;
      await this.leads.save(lead, manager);
    } else if (operation.kind === 'bitrix_deal_convert') {
      const dealId = operation.payload.dealId;
      if (!dealId) throw new ConflictException('Operation has no deal scope');
      const deal = await this.deals.findByIdForUpdate(dealId, manager);
      if (!deal) throw new NotFoundException('Deal was not found');
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `bitrix-deal/${deal.portalKey}/${remoteId}`,
      ]);
      const collision = await this.deals.findByPortalRemote(deal.portalKey, remoteId, manager);
      if (collision && collision.id !== deal.id)
        throw new ConflictException('Remote deal is linked to another local deal');
      deal.bitrixDealId = remoteId;
      deal.conversionStatus = 'completed';
      await this.deals.save(deal, manager);
    } else {
      throw new ConflictException('This operation cannot link a remote CRM record');
    }
  }

  private async reprocessIdentityTarget(
    snapshot: OperationEntity,
    input: OperationResolveDto,
    actor: Actor,
  ): Promise<OperationDto> {
    return this.dataSource.transaction(async (manager) => {
      const operation = await this.operations.findByIdForUpdate(snapshot.id, manager);
      if (!operation || ACTIVE_OPERATION_STATUSES.has(operation.status))
        throw new ConflictException('Operation state changed during resolution');
      if (operation.kind !== 'tiktok_ingest' || !operation.payload.eventId)
        throw new ConflictException('Identity selection only applies to TikTok ingest operations');
      if (operation.aggregateId)
        await this.assertNoActiveAggregateOperation(manager, operation.id, operation.aggregateId);
      const event = await this.webhookEvents.findByIdForUpdate(operation.payload.eventId, manager);
      const targetLeadId = input.targetLeadId;
      const identityTargets = input.identityTargets;
      if (!targetLeadId || !identityTargets)
        throw new ConflictException('Identity selection is incomplete');
      const target = await this.leads.findByIdForUpdate(targetLeadId, manager);
      if (!event || !target || event.advertiserId !== target.advertiserId)
        throw new ConflictException('Identity target is outside the operation scope');

      for (const [identityType, rawValue] of Object.entries(identityTargets)) {
        if (
          !['email', 'phone'].includes(identityType) ||
          typeof rawValue !== 'string' ||
          !rawValue.trim()
        ) {
          throw new ConflictException(
            'Identity selection must contain normalized email or phone values',
          );
        }
        const identityKind = identityType as LeadIdentityEntity['identityType'];
        const value = rawValue.trim();
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${target.advertiserId}:${identityKind}:${value}`,
        ]);
        const owner = await this.identities.findOwner(
          target.advertiserId,
          identityKind,
          value,
          manager,
        );
        if (owner && owner.leadId !== target.id)
          throw new ConflictException('Identity is already owned by another lead');
        if (!owner) {
          await this.identities.save(
            {
              id: uuidv7(),
              advertiserId: target.advertiserId,
              identityType: identityKind,
              normalizedValue: value,
              leadId: target.id,
            },
            manager,
          );
        }
      }

      const before = auditState(operation);
      operation.payload = { ...operation.payload, resolvedTargetLeadId: target.id };
      operation.status = 'pending';
      operation.nextAttemptAt = null;
      operation.leaseUntil = null;
      operation.leaseToken = null;
      event.status = 'accepted';
      await this.webhookEvents.save(event, manager);
      await this.operations.save(operation, manager);
      await this.outbox.append(operation.id, QUEUE_NAMES.tiktokIngest, new Date(), manager);
      await this.audit(
        manager,
        operation,
        actor,
        'operation.resolved.select_identity_target',
        before,
        auditState(operation),
        input.reason,
      );
      return toOperationDto(operation);
    });
  }

  private async audit(
    manager: EntityManager,
    operation: OperationEntity,
    actor: Actor,
    eventType: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.auditEvents.record(
      {
        id: uuidv7(),
        scopeKey: 'crm-integration',
        actorId: actor.sub,
        eventType,
        aggregateType: 'operation',
        aggregateId: operation.id,
        metadata: { before, after, reason: redactReason(reason) },
      },
      manager,
    );
  }

  private async assertNoActiveAggregateOperation(
    manager: EntityManager,
    currentId: string,
    aggregateId: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `crm-aggregate/${aggregateId}`,
    ]);
    if (
      await this.operations.hasActiveAggregateOperation(
        aggregateId,
        currentId,
        [...ACTIVE_OPERATION_STATUSES],
        manager,
      )
    ) {
      throw new ConflictException('Another operation is active for this aggregate');
    }
  }
}

function queueFor(kind: string): QueueName {
  const queue = retryQueueForOperation(kind);
  if (!queue) {
    throw new ConflictException('Operation kind cannot be retried');
  }
  return queue;
}

function auditState(operation: OperationEntity): Record<string, unknown> {
  return {
    status: operation.status,
    attempt: operation.attempt,
    targetVersion: operation.targetVersion,
    errorCode: operation.lastErrorCode,
    revisions: operation.configRevisions,
  };
}

function redactReason(value: string): string {
  return value
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[phone]')
    .replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500);
}
