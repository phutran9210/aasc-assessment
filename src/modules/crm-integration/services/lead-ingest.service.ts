import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { OperationContext } from '../../../core/queue/types/worker.types.js';
import { OperationRepository } from '../../../core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '../../../core/queue/repositories/outbox.repository.js';
import { WebhookEventEntity } from '../../../core/queue/entities/webhook-event.entity.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '../types/integration.types.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { LeadIdentityEntity } from '../entities/lead-identity.entity.js';
import { SubmissionEntity } from '../entities/submission.entity.js';
import { ConfigurationEntity } from '../entities/configuration.entity.js';
import { LeadRepository } from '../repositories/lead.repository.js';
import { LeadIdentityRepository } from '../repositories/lead-identity.repository.js';
import { SubmissionRepository } from '../repositories/submission.repository.js';
import { normalizeLead } from '../domain/normalize-lead.js';
import { mergeLead } from '../domain/merge-lead.js';
import { scoreLead } from '../domain/lead-score.js';
import type { NormalizedLeadInput } from '../types/normalized-lead.type.js';
import type { ScorePolicy } from '../types/rule.types.js';
import { AnalyticsRevisionEntity } from '../../integration-analytics/entities/analytics-revision.entity.js';
import { ConversionFeedbackService } from '../../tiktok/services/conversion-feedback.service.js';

export type IngestOutcome =
  | { outcome: 'succeeded'; leadId: string; version: number }
  | { outcome: 'quarantined'; errorCode: string }
  | { outcome: 'awaiting_link'; submissionId: string; nextAttemptAt: Date | null }
  | { outcome: 'unmatched'; submissionId: string };

const DEFAULT_SCORE_POLICY: ScorePolicy = {
  weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
  interaction_window_days: 30,
  interaction_points: 5,
  interaction_cap: 4,
};
const LINK_INTERVAL_MS = 5 * 60 * 1000;
const LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LeadIngestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly leads: LeadRepository,
    private readonly identities: LeadIdentityRepository,
    private readonly submissions: SubmissionRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly portalKey: string,
    private readonly region = 'VN',
    private readonly feedback?: ConversionFeedbackService,
  ) {}

  async process(
    eventId: string,
    context: OperationContext,
    resolvedTargetLeadId?: string,
  ): Promise<IngestOutcome> {
    await context.assertOwnership();
    return this.dataSource.transaction(async (manager) => {
      const event = await manager
        .getRepository(WebhookEventEntity)
        .findOne({ where: { id: eventId } });
      if (!event || event.provider !== 'tiktok')
        return { outcome: 'quarantined', errorCode: 'EVENT_NOT_FOUND' };
      if (event.eventType === 'form.complete' || event.eventType === 'user.interaction') {
        return this.processAssociationEvent(event, context, manager);
      }
      if (event.eventType !== 'lead.generate') {
        await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'ignored' });
        return { outcome: 'quarantined', errorCode: 'EVENT_TYPE_UNSUPPORTED' };
      }

      const payload = event.payload;
      const providerLeadId = stringValue(payload.provider_lead_id);
      const normalizedResult = normalizeLead(
        {
          id: providerLeadId ?? '',
          advertiserId: event.advertiserId ?? event.scopeKey,
          eventKey: event.eventKey,
          occurredAt: event.occurredAt?.toISOString() ?? stringValue(payload.timestamp),
          fields: payload,
          campaign: pickObject(payload, 'campaign'),
          ad: pickObject(payload, 'ad'),
          form: pickObject(payload, 'form'),
          utm: pickObject(payload, 'utm'),
          consent: pickObject(payload, 'consent'),
          customQuestions: Array.isArray(record(payload.lead_data).custom_questions)
            ? (record(payload.lead_data).custom_questions as Array<{
                question?: string;
                questionId?: string;
                questionText?: string;
                answer: unknown;
              }>)
            : undefined,
        },
        this.region,
      );
      if (normalizedResult.kind === 'quarantined') {
        const errorCode = normalizedResult.reason;
        await manager
          .getRepository(WebhookEventEntity)
          .update(event.id, { status: 'quarantined', errorCode });
        return { outcome: 'quarantined', errorCode };
      }
      const normalized = normalizedResult.data;
      const submissionKey = normalized.providerLeadId ?? event.eventKey;
      const normalizedPayloadHash = createHash('sha256')
        .update(JSON.stringify({ ...normalized, eventKey: undefined }))
        .digest('hex');
      const existingSubmission = await this.submissions.findByKey(
        normalized.advertiserId,
        event.providerMode as 'mock' | 'business-api',
        submissionKey,
        manager,
      );
      if (existingSubmission) {
        if (existingSubmission.payloadHash !== normalizedPayloadHash) {
          await manager.getRepository(WebhookEventEntity).update(event.id, {
            status: 'quarantined',
            errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT',
          });
          return { outcome: 'quarantined', errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT' };
        }
        const leadId = existingSubmission.leadId;
        const lead = leadId ? await this.leads.findById(leadId, manager) : null;
        await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
        return lead
          ? { outcome: 'succeeded', leadId: lead.id, version: lead.version }
          : {
              outcome: 'awaiting_link',
              submissionId: existingSubmission.id,
              nextAttemptAt: existingSubmission.nextLinkAttemptAt,
            };
      }

      const identityKeys = identityValues(normalized).map(
        ({ type, value }) => `${normalized.advertiserId}:${type}:${value}`,
      );
      return this.leads.withIdentityLocks(
        identityKeys,
        async () => {
          await context.assertOwnership();
          const values = identityValues(normalized);
          const found = await this.identities.findByValues(
            normalized.advertiserId,
            values,
            manager,
          );
          const leadIds = [...new Set(found.map((identity) => identity.leadId))];
          if (leadIds.length > 1 && !resolvedTargetLeadId) {
            await manager.getRepository(WebhookEventEntity).update(event.id, {
              status: 'quarantined',
              errorCode: 'IDENTITY_CONFLICT',
            });
            return { outcome: 'quarantined', errorCode: 'IDENTITY_CONFLICT' };
          }

          const repo = manager.getRepository(LeadEntity);
          let lead = resolvedTargetLeadId
            ? await repo.findOne({ where: { id: resolvedTargetLeadId } })
            : leadIds.length
              ? await repo.findOne({ where: { id: leadIds[0] } })
              : null;
          if (resolvedTargetLeadId && (!lead || lead.advertiserId !== normalized.advertiserId)) {
            await manager.getRepository(WebhookEventEntity).update(event.id, {
              status: 'quarantined',
              errorCode: 'IDENTITY_TARGET_SCOPE_MISMATCH',
            });
            return { outcome: 'quarantined', errorCode: 'IDENTITY_TARGET_SCOPE_MISMATCH' };
          }
          const occurredAt = new Date(normalized.occurredAt ?? event.receivedAt.toISOString());
          const submissionId = uuidv7();
          const submission = this.createSubmission(
            event,
            normalized,
            submissionKey,
            submissionId,
            lead?.id ?? null,
            manager,
            normalizedPayloadHash,
          );
          await manager.getRepository(SubmissionEntity).save(submission);

          const isNewLead = !lead;
          let materialChange = isNewLead;
          if (!lead) {
            const externalSeed = normalized.providerLeadId ?? submissionKey;
            lead = repo.create({
              id: uuidv7(),
              externalId: `tiktok:${createHash('sha256').update(`${normalized.advertiserId}:${externalSeed}`).digest('hex')}`,
              advertiserId: normalized.advertiserId,
              scopeKey: normalized.advertiserId,
              portalKey: this.portalKey,
              providerMode: event.providerMode as 'mock' | 'business-api',
              name: normalized.name,
              email: normalized.email,
              phone: normalized.phone,
              city: normalized.city,
              interests: [...new Set(normalized.interests)].slice(0, 100),
              score: 0,
              scoreVersion: context.revisions.scoring ?? 1,
              scoreBreakdown: {},
              businessStatus: 'new',
              syncStatus: 'pending',
              bitrixLeadId: null,
              firstSubmissionId: submissionId,
              lastSubmissionId: submissionId,
              firstTouchAt: occurredAt,
              firstTouchCampaignId: normalized.campaignId,
              lastTouchAt: occurredAt,
              convertedAt: null,
              dealCreatedAt: null,
              fieldProvenance: Object.fromEntries(
                (['name', 'email', 'phone', 'city'] as const)
                  .filter((field) => normalized[field]?.trim())
                  .map((field) => [
                    field,
                    { occurredAt: occurredAt.toISOString(), eventKey: normalized.eventKey },
                  ]),
              ),
              lastWrittenFields: {},
              version: 1,
              lastErrorCode: null,
            });
            lead = await repo.save(lead);
          } else {
            const merged = mergeLead(lead, normalized);
            const attributionChanged =
              !lead.lastTouchAt || occurredAt.getTime() > lead.lastTouchAt.getTime();
            const firstChanged = occurredAt.getTime() < lead.firstTouchAt.getTime();
            const material = merged.changedFields.length > 0 || attributionChanged || firstChanged;
            materialChange = material;
            lead.name = merged.lead.name;
            lead.email = merged.lead.email;
            lead.phone = merged.lead.phone;
            lead.city = merged.lead.city;
            lead.interests = merged.lead.interests ?? [];
            lead.fieldProvenance = merged.lead.fieldProvenance;
            if (firstChanged) {
              lead.firstTouchAt = occurredAt;
              lead.firstTouchCampaignId = normalized.campaignId;
              lead.firstSubmissionId = submissionId;
            }
            if (attributionChanged) {
              lead.lastTouchAt = occurredAt;
              lead.lastSubmissionId = submissionId;
            }
            if (material) lead.version += 1;
            lead = await repo.save(lead);
          }
          submission.leadId = lead.id;
          submission.associationStatus = 'linked';
          submission.nextLinkAttemptAt = null;
          submission.associationExpiresAt = null;
          await manager.getRepository(SubmissionEntity).save(submission);
          for (const identity of values) {
            if (
              found.some(
                (row) =>
                  row.identityType === identity.type && row.normalizedValue === identity.value,
              )
            )
              continue;
            await manager.getRepository(LeadIdentityEntity).save({
              id: uuidv7(),
              advertiserId: normalized.advertiserId,
              identityType: identity.type,
              normalizedValue: identity.value,
              leadId: lead.id,
            });
          }

          const priorSubmissions = await manager
            .getRepository(SubmissionEntity)
            .find({ where: { leadId: lead.id } });
          const score = scoreLead(
            {
              email: lead.email,
              phone_e164: lead.phone,
              form_complete: true,
              interactions: priorSubmissions.flatMap((item) => {
                const engagement = item.engagement;
                return typeof engagement.event === 'string'
                  ? [
                      {
                        event_id: item.eventId,
                        occurred_at: item.occurredAt.toISOString(),
                        event: engagement.event,
                      },
                    ]
                  : [];
              }),
              budget_match: false,
              timeline_match: false,
            },
            await this.scorePolicy(manager, context.revisions.rules ?? 0),
            new Date().toISOString(),
          );
          lead.score = score.total;
          lead.scoreVersion = context.revisions.scoring ?? 1;
          lead.scoreBreakdown = score.breakdown;
          await repo.save(lead);
          if (isNewLead || materialChange) {
            await manager
              .createQueryBuilder()
              .update(AnalyticsRevisionEntity)
              .set({ revision: () => 'revision + 1' })
              .where('id = :id', { id: '00000000-0000-7000-8000-000000000001' })
              .execute();
          }

          if (materialChange) await this.scheduleLeadSync(lead, context, manager);
          await manager
            .getRepository(WebhookEventEntity)
            .update(event.id, { status: 'processed', errorCode: null });
          return { outcome: 'succeeded', leadId: lead.id, version: lead.version };
        },
        manager,
      );
    });
  }

  private async processAssociationEvent(
    event: WebhookEventEntity,
    context: OperationContext,
    manager: EntityManager,
  ): Promise<IngestOutcome> {
    const payload = event.payload;
    const providerLeadId = stringValue(payload.provider_lead_id);
    const linkedSubmission = providerLeadId
      ? await manager.getRepository(SubmissionEntity).findOne({
          where: {
            advertiserId: event.advertiserId ?? event.scopeKey,
            providerLeadId,
            associationStatus: 'linked',
          },
          order: { occurredAt: 'DESC' },
        })
      : null;
    const lead = linkedSubmission?.leadId
      ? await this.leads.findById(linkedSubmission.leadId, manager)
      : null;
    const submissionKey = event.eventKey;
    const repo = manager.getRepository(SubmissionEntity);
    let submission = await this.submissions.findByKey(
      event.advertiserId ?? event.scopeKey,
      event.providerMode as 'mock' | 'business-api',
      submissionKey,
      manager,
    );
    const now = new Date();
    if (submission && submission.payloadHash !== event.payloadHash) {
      await manager.getRepository(WebhookEventEntity).update(event.id, {
        status: 'quarantined',
        errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT',
      });
      return { outcome: 'quarantined', errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT' };
    }
    if (!submission) {
      const firstAttempt = now;
      submission = repo.create({
        id: uuidv7(),
        advertiserId: event.advertiserId ?? event.scopeKey,
        providerMode: event.providerMode as 'mock' | 'business-api',
        leadId: lead?.id ?? null,
        eventId: event.id,
        providerLeadId,
        submissionKey,
        campaignId: stringValue(payload.campaign_id),
        campaignName: null,
        adId: stringValue(payload.ad_id),
        adName: null,
        formId: stringValue(payload.form_id),
        formName: null,
        ttclid: stringValue(payload.ttclid),
        utm: {},
        customAnswers: {},
        engagement: {
          event:
            event.eventType === 'user.interaction'
              ? stringValue(payload.interaction_type)
              : 'form_complete',
        },
        consent: {},
        occurredAt: event.occurredAt ?? now,
        isHistorical: false,
        applyRules: true,
        sendFeedback: true,
        payloadHash: event.payloadHash,
        associationStatus: lead ? 'linked' : 'waiting_link',
        linkAttemptCount: 0,
        nextLinkAttemptAt: lead ? null : new Date(firstAttempt.getTime() + LINK_INTERVAL_MS),
        associationExpiresAt: lead ? null : new Date(firstAttempt.getTime() + LINK_MAX_AGE_MS),
      });
      submission = await repo.save(submission);
    } else if (!lead && submission.associationStatus === 'waiting_link') {
      if (submission.associationExpiresAt && submission.associationExpiresAt <= now) {
        submission.associationStatus = 'unmatched';
        submission.nextLinkAttemptAt = null;
        await repo.save(submission);
        await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
        return { outcome: 'unmatched', submissionId: submission.id };
      }
      submission.linkAttemptCount += 1;
      submission.nextLinkAttemptAt = new Date(now.getTime() + LINK_INTERVAL_MS);
      await repo.save(submission);
    }
    if (lead) {
      submission.leadId = lead.id;
      submission.associationStatus = 'linked';
      submission.nextLinkAttemptAt = null;
      await repo.save(submission);
      const oldVersion = lead.version;
      const priorTouch = lead.lastTouchAt;
      const occurredAt = event.occurredAt ?? now;
      const touchChanged = !priorTouch || occurredAt > priorTouch;
      if (touchChanged) {
        lead.lastTouchAt = occurredAt;
        lead.lastSubmissionId = submission.id;
      }
      await this.recomputeScore(lead, context, manager, touchChanged);
      if (lead.score >= 70) await this.feedback?.schedule(lead.id, 'lead_qualified', manager);
      if (touchChanged || lead.version !== oldVersion)
        await this.scheduleLeadSync(lead, context, manager);
      if (touchChanged)
        await manager
          .createQueryBuilder()
          .update(AnalyticsRevisionEntity)
          .set({ revision: () => 'revision + 1' })
          .where('id = :id', { id: '00000000-0000-7000-8000-000000000001' })
          .execute();
      await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
      return { outcome: 'succeeded', leadId: lead.id, version: lead.version };
    }
    await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
    if (submission.associationStatus === 'waiting_link') {
      await this.scheduleLinkRetry(submission, context, manager);
      return {
        outcome: 'awaiting_link',
        submissionId: submission.id,
        nextAttemptAt: submission.nextLinkAttemptAt,
      };
    }
    return { outcome: 'unmatched', submissionId: submission.id };
  }

  private async recomputeScore(
    lead: LeadEntity,
    context: OperationContext,
    manager: EntityManager,
    touchChanged: boolean,
  ): Promise<void> {
    const submissions = await manager
      .getRepository(SubmissionEntity)
      .find({ where: { leadId: lead.id } });
    const score = scoreLead(
      {
        email: lead.email,
        phone_e164: lead.phone,
        form_complete: submissions.some((item) => item.engagement.event === 'form_complete'),
        interactions: submissions.flatMap((item) =>
          typeof item.engagement.event === 'string' && item.engagement.event !== 'form_complete'
            ? [
                {
                  event_id: item.eventId,
                  occurred_at: item.occurredAt.toISOString(),
                  event: item.engagement.event,
                },
              ]
            : [],
        ),
        budget_match: false,
        timeline_match: false,
      },
      await this.scorePolicy(manager, context.revisions.rules ?? 0),
      new Date().toISOString(),
    );
    const scoreChanged =
      lead.score !== score.total ||
      JSON.stringify(lead.scoreBreakdown) !== JSON.stringify(score.breakdown);
    lead.score = score.total;
    lead.scoreVersion = context.revisions.scoring ?? 1;
    lead.scoreBreakdown = score.breakdown;
    if (touchChanged || scoreChanged) lead.version += 1;
    await manager.getRepository(LeadEntity).save(lead);
  }

  private async scorePolicy(manager: EntityManager, revision: number): Promise<ScorePolicy> {
    if (revision > 0) {
      const config = await manager
        .getRepository(ConfigurationEntity)
        .findOne({ where: { key: 'rules', revision } });
      const value = config?.value.config ?? config?.value;
      const scoring = record(value).quality_scoring;
      if (scoring && typeof scoring === 'object') return scoring as ScorePolicy;
    }
    return DEFAULT_SCORE_POLICY;
  }

  private createSubmission(
    event: WebhookEventEntity,
    normalized: NormalizedLeadInput,
    submissionKey: string,
    id: string,
    leadId: string | null,
    manager: EntityManager,
    payloadHash: string,
  ): SubmissionEntity {
    const repo = manager.getRepository(SubmissionEntity);
    return repo.create({
      id,
      advertiserId: normalized.advertiserId,
      providerMode: event.providerMode as 'mock' | 'business-api',
      leadId,
      eventId: event.id,
      providerLeadId: normalized.providerLeadId,
      submissionKey,
      campaignId: normalized.campaignId,
      campaignName: normalized.campaignName,
      adId: normalized.adId,
      adName: normalized.adName,
      formId: normalized.formId,
      formName: normalized.formName,
      ttclid: normalized.ttclid,
      utm: normalized.utm,
      customAnswers: normalized.customAnswers,
      engagement: { event: 'form_complete' },
      consent: normalized.consent,
      occurredAt: new Date(normalized.occurredAt ?? event.receivedAt.toISOString()),
      isHistorical: normalized.isHistorical,
      applyRules: normalized.applyRules,
      sendFeedback: normalized.sendFeedback,
      payloadHash,
      associationStatus: leadId ? 'linked' : 'waiting_link',
      linkAttemptCount: 0,
      nextLinkAttemptAt: null,
      associationExpiresAt: null,
    });
  }

  private async scheduleLeadSync(
    lead: LeadEntity,
    context: OperationContext,
    manager: EntityManager,
  ): Promise<void> {
    const operation = await this.operations.ensure(
      {
        operationKey: `bitrix-lead-sync/${lead.id}/${lead.version}`,
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

  private async scheduleLinkRetry(
    submission: SubmissionEntity,
    context: OperationContext,
    manager: EntityManager,
  ): Promise<void> {
    const attempt = submission.linkAttemptCount + 1;
    const operation = await this.operations.ensure(
      {
        operationKey: `tiktok-link/${submission.id}/${attempt}`,
        kind: OPERATION_KINDS.tiktokIngest,
        payload: { eventId: submission.eventId },
        configRevisions: context.revisions,
      },
      manager,
    );
    await this.outbox.append(
      operation.id,
      QUEUE_NAMES.tiktokIngest,
      submission.nextLinkAttemptAt ?? new Date(Date.now() + LINK_INTERVAL_MS),
      manager,
    );
  }
}

function identityValues(
  input: NormalizedLeadInput,
): Array<{ type: 'email' | 'phone'; value: string }> {
  return [
    ...(input.email ? [{ type: 'email' as const, value: input.email }] : []),
    ...(input.phone ? [{ type: 'phone' as const, value: input.phone }] : []),
  ];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pickObject(
  payload: Record<string, unknown>,
  key: string,
): { id?: string; name?: string } | undefined {
  const value = record(payload[key]);
  return Object.keys(value).length ? value : undefined;
}
