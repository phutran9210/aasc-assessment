import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { SubmissionEntity } from '../entities/submission.entity.js';
import { LeadRepository } from '../repositories/lead.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/index.js';
import { applyMapping } from '../domain/apply-mapping.js';
import type { CompiledMapping } from '../domain/mapping-compiler.js';
import { buildLeadDiff } from '../domain/crm-lead-diff.js';
import { normalizeEmail, normalizePhone } from '../domain/normalize-contact.js';
import type { NormalizedLeadInput } from '../types/normalized-lead.type.js';
import type { CrmGateway, RemoteLead } from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { RemoteReconciliationService } from './remote-reconciliation.service.js';
import { TimelineService } from './timeline.service.js';
import {
  EXTERNAL_MARKER_FIELD,
  FALLBACK_MAPPING,
  LEAD_SYNC_RECONCILIATION_DELAYS_MS,
} from '../constants/flow.constants.js';

@Injectable()
export class LeadSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly leads: LeadRepository,
    private readonly submissions: SubmissionRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly analyticsRevisions: AnalyticsRevisionRepository,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly reconciliation: RemoteReconciliationService,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly timeline: TimelineService,
    private readonly region = 'VN',
  ) {}

  async sync(
    leadId: string,
    targetVersion: number,
    context: OperationContext,
    reconciliationAttempt = 0,
  ): Promise<OperationOutcome> {
    const lease = await context.acquireAggregateLease(`lead/${leadId}`);
    if (!lease) {
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(Date.now() + 5_000),
        errorCode: 'LEAD_SYNC_LEASE_BUSY',
      };
    }
    try {
      await context.assertOwnership();
      const lead = await this.leads.findById(leadId, this.dataSource.manager);
      if (!lead) return { outcome: 'quarantined', errorCode: 'LEAD_NOT_FOUND' };
      if (targetVersion < lead.version && lead.syncStatus !== 'reconcile_required') {
        if (lead.syncStatus !== 'synced') await this.enqueueLatestIfMissing(lead, context);
        return { outcome: 'succeeded' };
      }

      const marker = `aasc-tiktok/${lead.id}`;
      const lookup = await this.reconciliation.find('lead', marker);
      if (lookup.status === 'ambiguous') {
        await this.markSyncState(lead.id, 'reconcile_required', 'LEAD_MARKER_AMBIGUOUS');
        return { outcome: 'reconcile_required', errorCode: 'LEAD_MARKER_AMBIGUOUS' };
      }
      let remote: RemoteLead | null =
        lookup.status === 'found' ? (lookup.value as RemoteLead) : null;

      if (!remote && lead.bitrixLeadId) {
        try {
          remote = await this.gateway.getLead(lead.bitrixLeadId);
        } catch (error) {
          if (!(error instanceof NotFoundException))
            return this.retryOutcome(error, 'CRM_REMOTE_GET_FAILED');
        }
      }

      if (!remote && lead.syncStatus === 'reconcile_required') {
        if (reconciliationAttempt > 0)
          return this.scheduleReconciliation(lead, context, reconciliationAttempt);
        await this.scheduleReconciliation(lead, context, 0);
        return { outcome: 'succeeded' };
      }

      const submission = await this.submissions.findLatestForLead(lead.id, this.dataSource.manager);
      if (!submission) return { outcome: 'quarantined', errorCode: 'LEAD_SUBMISSION_MISSING' };
      const normalized = toNormalizedLead(lead, submission, this.region);
      const compiled = await this.mapping(context.revisions.mapping ?? 0);
      const fields = applyMapping(normalized, compiled);

      if (!remote) {
        const duplicates = await this.findContactDuplicates(normalized);
        if (duplicates.kind === 'unavailable')
          return {
            outcome: 'retry_wait',
            nextAttemptAt: new Date(Date.now() + 5_000),
            errorCode: 'CRM_DUPLICATE_LOOKUP_UNAVAILABLE',
          };
        if (duplicates.candidates.length > 1) {
          await this.markSyncState(lead.id, 'failed', 'CRM_DUPLICATE_CANDIDATES_AMBIGUOUS');
          return { outcome: 'quarantined', errorCode: 'CRM_DUPLICATE_CANDIDATES_AMBIGUOUS' };
        }
        remote = duplicates.candidates[0] ?? null;
      }

      let lastWrittenFields: Record<string, unknown>;
      if (!remote) {
        await context.assertOwnership();
        try {
          remote = await this.gateway.createLead(fields, marker);
          lastWrittenFields = fields;
        } catch {
          const afterCreate = await this.reconcileAfterCreate(marker);
          if (afterCreate.kind === 'found') {
            remote = afterCreate.value;
            lastWrittenFields = fields;
          } else if (afterCreate.kind === 'ambiguous') {
            await this.markSyncState(lead.id, 'reconcile_required', 'LEAD_MARKER_AMBIGUOUS');
            return { outcome: 'reconcile_required', errorCode: 'LEAD_MARKER_AMBIGUOUS' };
          } else {
            await this.markSyncState(lead.id, 'reconcile_required', 'CRM_CREATE_AMBIGUOUS');
            await this.scheduleReconciliation(lead, context, 0);
            return { outcome: 'reconcile_required', errorCode: 'CRM_CREATE_AMBIGUOUS' };
          }
        }
      } else {
        const diff = buildLeadDiff(fields, remote.fields, lead.lastWrittenFields, compiled);
        lastWrittenFields = diff.lastWrittenFields;
        const patch = { ...diff.patch };
        if (remote.marker !== marker) patch[EXTERNAL_MARKER_FIELD] = marker;
        if (Object.keys(patch).length) {
          await context.assertOwnership();
          remote = await this.gateway.updateLead(remote.id, patch);
        }
      }

      if (remote.stale) {
        return {
          outcome: 'retry_wait',
          nextAttemptAt: new Date(Date.now() + 5_000),
          errorCode: 'CRM_REMOTE_SNAPSHOT_STALE',
        };
      }
      await context.assertOwnership();
      await this.persistSync(lead, remote, lastWrittenFields, marker, context);
      return { outcome: 'succeeded', remoteId: remote.id };
    } catch (error) {
      return this.retryOutcome(error, 'LEAD_SYNC_FAILED');
    } finally {
      await context.releaseAggregateLease(lease);
    }
  }

  private async findContactDuplicates(
    lead: NormalizedLeadInput,
  ): Promise<{ kind: 'found' | 'unavailable'; candidates: RemoteLead[] }> {
    try {
      const candidates = await this.gateway.findLeadDuplicates({
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
      });
      return {
        kind: 'found',
        candidates: [...new Map(candidates.map((item) => [item.id, item])).values()],
      };
    } catch {
      return { kind: 'unavailable', candidates: [] };
    }
  }

  private async reconcileAfterCreate(
    marker: string,
  ): Promise<{ kind: 'found'; value: RemoteLead } | { kind: 'not_found' } | { kind: 'ambiguous' }> {
    try {
      const result = await this.reconciliation.find('lead', marker);
      if (result.status === 'found') return { kind: 'found', value: result.value as RemoteLead };
      return result.status === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'not_found' };
    } catch {
      return { kind: 'not_found' };
    }
  }

  private async mapping(revision: number): Promise<CompiledMapping> {
    if (!revision) return FALLBACK_MAPPING;
    const config = await this.configurations.findRevision('mapping', revision);
    const compiled = config?.value.compiled;
    if (
      compiled &&
      typeof compiled === 'object' &&
      Array.isArray((compiled as CompiledMapping).entries)
    )
      return compiled as CompiledMapping;
    if (config) throw new BadRequestException('Stored mapping revision is invalid');
    return FALLBACK_MAPPING;
  }

  private async persistSync(
    snapshot: LeadEntity,
    remote: RemoteLead,
    lastWrittenFields: Record<string, unknown>,
    marker: string,
    context: OperationContext,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const lead = await this.leads.findByIdForUpdate(snapshot.id, manager);
      if (!lead) return;
      lead.bitrixLeadId = remote.id;
      lead.lastWrittenFields = lastWrittenFields;
      lead.syncStatus = lead.version === snapshot.version ? 'synced' : 'pending';
      lead.lastErrorCode = null;
      lead.fieldProvenance = {
        ...lead.fieldProvenance,
        crm: {
          marker,
          remoteId: remote.id,
          syncedVersion: snapshot.version,
          syncedAt: new Date().toISOString(),
        },
      };
      await this.leads.save(lead, manager);
      await this.analyticsRevisions.increment(manager);
      await this.timeline.append(
        {
          leadId: lead.id,
          entityType: 'lead',
          entityId: remote.id,
          marker: `aasc-tiktok/lead/${lead.id}/version/${snapshot.version}`,
          comment: `Lead synchronized from TikTok (version ${snapshot.version}).`,
        },
        context,
        manager,
      );
      if (lead.version !== snapshot.version)
        await this.enqueueLatestInTransaction(lead, context, manager);
    });
  }

  private async enqueueLatestIfMissing(lead: LeadEntity, context: OperationContext): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.enqueueLatestInTransaction(lead, context, manager),
    );
  }

  private async enqueueLatestInTransaction(
    lead: LeadEntity,
    context: OperationContext,
    manager: EntityManager,
  ): Promise<void> {
    const operationKey = `bitrix-lead-sync/${lead.id}/${lead.version}`;
    const existing = await this.operations.findByKey(operationKey, manager);
    if (existing) return;
    const operation = await this.operations.ensure(
      {
        operationKey,
        kind: OPERATION_KINDS.bitrixLeadSync,
        aggregateId: lead.id,
        targetVersion: lead.version,
        payload: { leadId: lead.id, targetVersion: lead.version },
        configRevisions: context.revisions,
      },
      manager,
    );
    await this.outbox.append(operation.id, QUEUE_NAMES.bitrixLeadSync, new Date(), manager);
  }

  private async scheduleReconciliation(
    lead: LeadEntity,
    context: OperationContext,
    currentAttempt: number,
  ): Promise<OperationOutcome> {
    const nextAttempt = currentAttempt + 1;
    if (nextAttempt > LEAD_SYNC_RECONCILIATION_DELAYS_MS.length) {
      await this.markSyncState(lead.id, 'reconcile_required', 'CRM_RECONCILIATION_EXHAUSTED');
      return { outcome: 'reconcile_required', errorCode: 'CRM_RECONCILIATION_EXHAUSTED' };
    }
    const delayMs =
      LEAD_SYNC_RECONCILIATION_DELAYS_MS[nextAttempt - 1] ?? LEAD_SYNC_RECONCILIATION_DELAYS_MS[0];
    const availableAt = new Date(Date.now() + (delayMs ?? 5_000));
    await this.dataSource.transaction(async (manager) => {
      const operation = await this.operations.ensure(
        {
          operationKey: `bitrix-lead-reconcile/${lead.id}/${lead.version}/${nextAttempt}`,
          kind: OPERATION_KINDS.bitrixLeadSync,
          aggregateId: lead.id,
          targetVersion: lead.version,
          payload: {
            leadId: lead.id,
            targetVersion: lead.version,
            reconciliationAttempt: nextAttempt,
          },
          configRevisions: context.revisions,
        },
        manager,
      );
      await this.outbox.append(operation.id, QUEUE_NAMES.bitrixLeadSync, availableAt, manager);
      await this.leads.update(
        lead.id,
        { syncStatus: 'reconcile_required', lastErrorCode: 'CRM_CREATE_AMBIGUOUS' },
        manager,
      );
    });
    return { outcome: 'reconcile_required', errorCode: 'CRM_CREATE_AMBIGUOUS' };
  }

  private async markSyncState(
    leadId: string,
    syncStatus: LeadEntity['syncStatus'],
    errorCode: string,
  ): Promise<void> {
    await this.leads.update(
      leadId,
      { syncStatus, lastErrorCode: errorCode },
      this.dataSource.manager,
    );
  }

  private retryOutcome(error: unknown, fallbackCode: string): OperationOutcome {
    const status = error instanceof HttpException ? error.getStatus() : null;
    const code =
      status === 429 ? 'CRM_RATE_LIMITED' : status === 503 ? 'CRM_UNAVAILABLE' : fallbackCode;
    return { outcome: 'retry_wait', nextAttemptAt: new Date(Date.now() + 5_000), errorCode: code };
  }
}

function toNormalizedLead(
  lead: LeadEntity,
  submission: SubmissionEntity,
  region: string,
): NormalizedLeadInput {
  return {
    providerLeadId: submission.providerLeadId,
    advertiserId: lead.advertiserId,
    eventKey: submission.eventId,
    occurredAt: submission.occurredAt.toISOString(),
    name: lead.name,
    email: normalizeEmail(lead.email),
    phone: normalizePhone(lead.phone, region),
    city: lead.city,
    campaignId: submission.campaignId,
    campaignName: submission.campaignName,
    adId: submission.adId,
    adName: submission.adName,
    formId: submission.formId,
    formName: submission.formName,
    ttclid: submission.ttclid,
    utm: submission.utm,
    customAnswers: submission.customAnswers,
    interests: lead.interests,
    consent: submission.consent,
    isHistorical: submission.isHistorical,
    applyRules: submission.applyRules,
    sendFeedback: submission.sendFeedback,
  };
}
