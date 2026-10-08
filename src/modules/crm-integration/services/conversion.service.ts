import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import { DealEntity } from '../entities/deal.entity.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { SubmissionEntity } from '../entities/submission.entity.js';
import { evaluateRules } from '../domain/rule-engine.js';
import { AssignmentService } from './assignment.service.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import type { CrmGateway, RemoteDeal } from '../ports/crm-gateway.port.js';
import { RemoteReconciliationService } from './remote-reconciliation.service.js';
import type { ConversionReceipt } from '../types/conversion-receipt.type.js';
import { TimelineService } from './timeline.service.js';
import { ConversionFeedbackService } from '@modules/tiktok/services/conversion-feedback.service.js';
import { LeadRepository } from '../repositories/lead.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { DealRepository } from '../repositories/deal.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { AssignmentPolicy, RulesConfig } from '../types/rule.types.js';

const LEAD_SUCCESS_STAGE = 'CONVERTED';
const MARKER_PREFIX = 'aasc-tiktok/deal/';
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

@Injectable()
export class ConversionService {
  private metadataCache: {
    expiresAt: number;
    value: Awaited<ReturnType<CrmGateway['metadata']>>;
  } | null = null;
  private metadataPending: Promise<Awaited<ReturnType<CrmGateway['metadata']>>> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configurations: ConfigurationRepository,
    private readonly assignments: AssignmentService,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly reconciliation: RemoteReconciliationService,
    private readonly timeline: TimelineService,
    private readonly leads: LeadRepository,
    private readonly submissions: SubmissionRepository,
    private readonly deals: DealRepository,
    private readonly analyticsRevisions: AnalyticsRevisionRepository,
    private readonly feedback?: ConversionFeedbackService,
  ) {}

  async request(
    leadId: string,
    trigger: 'rule' | 'manual',
    actorId?: string,
    idempotencyKey?: string,
    requestBody: Record<string, unknown> = {},
  ): Promise<ConversionReceipt | null> {
    const snapshot = await this.leads.findById(leadId, this.dataSource.manager);
    if (!snapshot) throw new NotFoundException('Lead was not found');
    assertConvertible(snapshot);

    const latestSubmission = await this.submissions.findLatestForLead(
      leadId,
      this.dataSource.manager,
    );
    if (trigger === 'rule' && (!latestSubmission || !latestSubmission.applyRules)) return null;

    let config: Awaited<ReturnType<ConfigurationRepository['findActive']>>;
    try {
      config = await this.configurations.findActive('rules');
    } catch {
      throw new ServiceUnavailableException('Conversion policy is unavailable');
    }
    const rules = config.value as unknown as RulesConfig;
    if (trigger === 'manual' && !rules.manual_conversion.enabled)
      throw new ConflictException('Manual conversion is disabled');
    const matched =
      trigger === 'rule' ? evaluateRules(ruleContext(snapshot, latestSubmission), rules) : null;
    if (trigger === 'rule' && (!rules.auto_conversion.enabled || !matched)) return null;
    const metadata = await this.metadata();
    const pipeline = matched?.rule ?? rules.manual_conversion;
    const stage = metadata.stages.find(
      (item) => item.categoryId === pipeline.pipeline_id && item.id === pipeline.stage_id,
    );
    if (!stage) throw new ConflictException('Configured pipeline stage is no longer available');

    const assignee = await this.dataSource.transaction(async (manager) => {
      const lead = await this.leads.findByIdForUpdate(leadId, manager);
      if (!lead) throw new NotFoundException('Lead was not found');
      assertConvertible(lead);
      let deal = await this.deals.findByLeadForUpdate(leadId, manager);
      if (deal) {
        if (deal.conversionStatus === 'failed' || deal.conversionStatus === 'reconcile_required')
          throw new ConflictException('Existing conversion requires operator reconciliation');
        const operation = await this.operations.findByKeyForUpdate(`convert/${leadId}`, manager);
        if (operation && idempotencyKey && actorId) {
          const scopeKey = idempotencyScopeKey(leadId, actorId, idempotencyKey);
          const bodyFingerprint = bodyHash(requestBody);
          const prior = operation.payload.idempotencyKeys?.[scopeKey];
          if (prior && prior.bodyHash !== bodyFingerprint) {
            throw new ConflictException('Idempotency key was reused with a different request body');
          }
          if (!prior) {
            operation.payload = {
              ...operation.payload,
              idempotencyKeys: {
                ...operation.payload.idempotencyKeys,
                [scopeKey]: { bodyHash: bodyFingerprint },
              },
            };
            await this.operations.save(operation, manager);
          }
        }
        if (deal.conversionStatus === 'completed' && deal.bitrixDealId)
          return {
            receipt: {
              status: 'completed',
              dealId: deal.id,
              bitrixDealId: deal.bitrixDealId,
            } as ConversionReceipt,
          };
        if (!operation) throw new ConflictException('Existing conversion is missing its operation');
        return {
          receipt: {
            status: 'pending',
            operationId: operation.id,
            dealId: deal.id,
          } as ConversionReceipt,
        };
      }

      const assignmentPolicy: AssignmentPolicy = {
        ...rules.assignment,
        fallback_sales_id:
          trigger === 'manual'
            ? rules.manual_conversion.fallback_sales_id
            : rules.assignment.fallback_sales_id,
      };
      const assignedTo = await this.assignments.reserve(assignmentPolicy, lead, manager);
      const activeUser = metadata.users.find((user) => user.id === assignedTo && user.active);
      if (!activeUser) throw new ConflictException('Configured assignee is not active');

      const title = `TikTok - ${lead.name} - ${latestSubmission?.formName ?? latestSubmission?.formId ?? 'Lead'}`;
      deal = await this.deals.save(
        this.deals.create(
          {
            id: uuidv7(),
            leadId,
            portalKey: lead.portalKey,
            bitrixDealId: null,
            title: title.slice(0, 255),
            amount: null,
            currency: null,
            pipelineId: String(pipeline.pipeline_id),
            stageId: pipeline.stage_id,
            stageSemantics: stage.semantic === 'won' || stage.semantic === 'S' ? 'won' : 'open',
            stageDeletedAt: null,
            probability: pipeline.probability,
            assignedTo,
            ruleRevision: config.entity.revision,
            conversionStatus: 'pending',
            remoteModifiedAt: null,
            everWonAt: null,
            currentSnapshotHash: null,
            version: 1,
          },
          manager,
        ),
        manager,
      );
      const operation = await this.operations.ensure(
        {
          operationKey: idempotencyKey ? `convert/${leadId}` : `convert/${leadId}`,
          kind: OPERATION_KINDS.bitrixDealConvert,
          aggregateId: leadId,
          targetVersion: lead.version,
          payload: {
            leadId,
            dealId: deal.id,
            ...(idempotencyKey && actorId
              ? {
                  idempotencyKeys: {
                    [idempotencyScopeKey(leadId, actorId, idempotencyKey)]: {
                      bodyHash: bodyHash(requestBody),
                    },
                  },
                }
              : {}),
          },
          configRevisions: { rules: config.entity.revision },
          actorId: actorId ?? null,
        },
        manager,
      );
      if (operation.status === 'pending')
        await this.outbox.append(operation.id, QUEUE_NAMES.bitrixDealConvert, new Date(), manager);
      return {
        receipt: {
          status: 'pending',
          operationId: operation.id,
          dealId: deal.id,
        } as ConversionReceipt,
      };
    });
    return assignee.receipt;
  }

  async requestManual(
    leadId: string,
    actorId: string,
    idempotencyKey: string | undefined,
    requestBody: Record<string, unknown>,
  ): Promise<ConversionReceipt> {
    const receipt = await this.request(leadId, 'manual', actorId, idempotencyKey, requestBody);
    if (!receipt) throw new ConflictException('Manual conversion did not produce an operation');
    return receipt;
  }

  async execute(operationId: string, context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.operations.findById(operationId, this.dataSource.manager);
    const dealId = operation?.payload.dealId;
    const leadId = operation?.payload.leadId;
    if (!operation || !dealId || !leadId)
      return { outcome: 'quarantined', errorCode: 'CONVERSION_PAYLOAD_INVALID' };

    const lease = await context.acquireAggregateLease(`lead/${leadId}`);
    if (!lease)
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(Date.now() + 5_000),
        errorCode: 'CONVERSION_LEASE_BUSY',
      };
    try {
      await context.assertOwnership();
      const deal = await this.deals.findById(dealId);
      const lead = await this.leads.findById(leadId, this.dataSource.manager);
      if (!deal || !lead)
        return { outcome: 'quarantined', errorCode: 'CONVERSION_AGGREGATE_MISSING' };
      if (deal.conversionStatus === 'completed' && deal.bitrixDealId)
        return { outcome: 'succeeded', remoteId: deal.bitrixDealId };
      if (!lead.bitrixLeadId || lead.syncStatus !== 'synced')
        return { outcome: 'quarantined', errorCode: 'LEAD_NOT_SYNCED' };

      if (!deal.bitrixDealId) {
        const marker = `${MARKER_PREFIX}${deal.id}`;
        const markerResult = await this.reconciliation.find('deal', marker);
        if (markerResult.status === 'ambiguous') {
          await this.updateDeal(deal.id, { conversionStatus: 'reconcile_required' });
          return { outcome: 'quarantined', errorCode: 'DEAL_MARKER_AMBIGUOUS' };
        }
        let remote = markerResult.status === 'found' ? (markerResult.value as RemoteDeal) : null;
        if (!remote) {
          const linked = await this.gateway.findDeals({ leadId: lead.bitrixLeadId, limit: 2 });
          if (linked.length > 1) {
            await this.updateDeal(deal.id, { conversionStatus: 'failed' });
            return { outcome: 'quarantined', errorCode: 'LEAD_HAS_MULTIPLE_DEALS' };
          }
          remote = linked[0] ?? null;
        }
        if (!remote) {
          if (deal.conversionStatus === 'creating_deal') {
            await this.updateDeal(deal.id, { conversionStatus: 'reconcile_required' });
            return { outcome: 'reconcile_required', errorCode: 'DEAL_CREATE_ALREADY_ATTEMPTED' };
          }
          await context.assertOwnership();
          await this.updateDeal(deal.id, { conversionStatus: 'creating_deal' });
          try {
            remote = await this.gateway.createDeal(
              {
                title: deal.title,
                leadId: lead.bitrixLeadId,
                categoryId: Number(deal.pipelineId),
                stageId: deal.stageId,
                assignedById: deal.assignedTo,
                probability: deal.probability,
              },
              marker,
            );
          } catch {
            const found = await this.reconciliation.find('deal', marker);
            if (found.status === 'found') remote = found.value as RemoteDeal;
            else {
              await this.updateDeal(deal.id, { conversionStatus: 'reconcile_required' });
              await this.scheduleRetry(deal.id, operation, context);
              return { outcome: 'reconcile_required', errorCode: 'DEAL_CREATE_AMBIGUOUS' };
            }
          }
        }
        await context.assertOwnership();
        await this.dataSource.transaction(async (manager) => {
          await this.deals.update(
            deal.id,
            {
              bitrixDealId: remote.id,
              conversionStatus: 'deal_created',
            },
            manager,
          );
          await this.leads.update(
            lead.id,
            {
              dealCreatedAt: new Date(),
            },
            manager,
          );
          await this.feedback?.schedule(lead.id, 'deal_created', manager);
        });
        deal.bitrixDealId = remote.id;
      }

      await context.assertOwnership();
      await this.updateDeal(deal.id, { conversionStatus: 'completing_lead' });
      try {
        await this.gateway.completeLead(lead.bitrixLeadId, LEAD_SUCCESS_STAGE);
      } catch {
        await this.updateDeal(deal.id, { conversionStatus: 'retry_wait' });
        return {
          outcome: 'retry_wait',
          nextAttemptAt: new Date(Date.now() + 5_000),
          errorCode: 'LEAD_COMPLETION_FAILED',
        };
      }
      await context.assertOwnership();
      const completedAt = new Date();
      await this.dataSource.transaction(async (manager) => {
        await this.deals.update(
          deal.id,
          {
            conversionStatus: 'completed',
            version: () => 'version + 1',
          },
          manager,
        );
        await this.leads.update(
          lead.id,
          {
            businessStatus: 'converted',
            convertedAt: completedAt,
          },
          manager,
        );
        await this.analyticsRevisions.increment(manager);
        await this.timeline.append(
          {
            entityType: 'deal',
            entityId: deal.bitrixDealId ?? '',
            marker: `aasc-tiktok/timeline/${lead.id}/deal-created`,
            comment: `TikTok lead converted to deal ${deal.bitrixDealId ?? ''}`,
            leadId: lead.id,
          },
          context,
          manager,
        );
      });
      const latestDeal = await this.deals.findById(deal.id);
      return { outcome: 'succeeded', remoteId: latestDeal?.bitrixDealId ?? deal.bitrixDealId };
    } finally {
      await context.releaseAggregateLease(lease);
    }
  }

  private updateDeal(id: string, patch: Partial<DealEntity>): Promise<unknown> {
    return this.deals.update(id, patch, this.dataSource.manager);
  }

  private async metadata(): Promise<Awaited<ReturnType<CrmGateway['metadata']>>> {
    if (this.metadataCache && this.metadataCache.expiresAt > Date.now())
      return this.metadataCache.value;
    if (!this.metadataPending) {
      this.metadataPending = this.gateway.metadata().catch(() => {
        throw new ServiceUnavailableException('CRM metadata is unavailable');
      });
      try {
        const value = await this.metadataPending;
        this.metadataCache = { value, expiresAt: Date.now() + 5_000 };
        return value;
      } finally {
        this.metadataPending = null;
      }
    }
    return this.metadataPending;
  }

  private async scheduleRetry(
    dealId: string,
    operation: OperationEntity,
    context: OperationContext,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const deal = await this.deals.findByIdForUpdate(dealId, manager);
      if (!deal) return;
      const attempt = Math.min(deal.version, RETRY_DELAYS_MS.length);
      const when = new Date(Date.now() + (RETRY_DELAYS_MS[attempt - 1] ?? 5_000));
      const retry = await this.operations.ensure(
        {
          operationKey: `convert/${deal.leadId}/reconcile/${attempt}`,
          kind: OPERATION_KINDS.bitrixDealConvert,
          aggregateId: deal.leadId,
          targetVersion: operation.targetVersion ?? undefined,
          payload: { leadId: deal.leadId, dealId: deal.id },
          configRevisions: operation.configRevisions,
          actorId: operation.actorId ?? undefined,
        },
        manager,
      );
      await this.outbox.append(retry.id, QUEUE_NAMES.bitrixDealConvert, when, manager);
      deal.version += 1;
      await this.deals.save(deal, manager);
      void context;
    });
  }
}

function assertConvertible(lead: LeadEntity): void {
  if (lead.syncStatus !== 'synced')
    throw new ConflictException('Lead must be synced before conversion');
  const conflicts = lead.fieldProvenance?.crmConflicts;
  if (Array.isArray(conflicts) && conflicts.length)
    throw new ConflictException('Lead has an unresolved CRM conflict');
}

function ruleContext(
  lead: LeadEntity,
  submission: SubmissionEntity | null,
): Record<string, unknown> {
  return {
    lead: {
      source: 'tiktok',
      campaign_id: submission?.campaignId,
      campaign_name: submission?.campaignName,
      ad_id: submission?.adId,
      form_id: submission?.formId,
      city: lead.city,
      budget: submission?.customAnswers.budget,
      timeline: submission?.customAnswers.timeline,
      quality_score: lead.score,
      email: lead.email,
      phone: lead.phone,
      advertiser_id: lead.advertiserId,
      event_name: submission?.engagement.eventName,
    },
  };
}
function idempotencyScopeKey(leadId: string, actorId: string, key: string): string {
  return createHash('sha256').update(`${leadId}\0${actorId}\0${key}`).digest('hex');
}

function bodyHash(body: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortObject(body)))
    .digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}
