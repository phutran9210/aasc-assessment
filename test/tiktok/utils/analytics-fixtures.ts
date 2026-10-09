import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { DealHistoryEntity } from '@modules/crm-integration/entities/deal-history.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';

export type LeadFixture = {
  advertiserId?: string;
  campaignId?: string | null;
  firstTouchAt: Date;
  createdAt?: Date;
  score?: number;
  scoreBreakdown?: Record<string, number>;
  email?: string | null;
  phone?: string | null;
};

export type DealFixture = {
  leadId: string;
  conversionStatus?: string;
  stageSemantics?: 'open' | 'won' | 'lost';
  amount?: string | null;
  currency?: string | null;
  deletedAt?: Date | null;
  everWonAt?: Date | null;
};

export type SubmissionFixture = {
  leadId: string | null;
  advertiserId?: string;
  campaignId?: string | null;
  occurredAt: Date;
  event?: string;
  applyRules?: boolean;
  isHistorical?: boolean;
};

/** Row-level fixtures for analytics and report tests; ingestion itself is covered elsewhere. */
export function analyticsFixtures(dataSource: DataSource, defaultAdvertiserId: string) {
  async function saveLead(input: LeadFixture): Promise<string> {
    const id = uuidv7();
    await dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `tiktok:${randomUUID()}`,
      advertiserId: input.advertiserId ?? defaultAdvertiserId,
      scopeKey: 'analytics-scope',
      portalKey: 'analytics-portal',
      providerMode: 'mock',
      name: `Lead ${id}`,
      email: input.email === undefined ? `${id}@example.test` : input.email,
      phone: input.phone ?? null,
      city: null,
      interests: [],
      score: input.score ?? 50,
      scoreVersion: 1,
      scoreBreakdown: input.scoreBreakdown ?? {},
      businessStatus: 'new',
      syncStatus: 'synced',
      bitrixLeadId: null,
      firstSubmissionId: null,
      lastSubmissionId: null,
      firstTouchAt: input.firstTouchAt,
      firstTouchCampaignId: input.campaignId === undefined ? 'cmp-1' : input.campaignId,
      lastTouchAt: input.firstTouchAt,
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version: 1,
      lastErrorCode: null,
      createdAt: input.createdAt ?? input.firstTouchAt,
      updatedAt: input.createdAt ?? input.firstTouchAt,
    });
    return id;
  }

  async function saveDeal(input: DealFixture): Promise<string> {
    const id = uuidv7();
    await dataSource.getRepository(DealEntity).save({
      id,
      leadId: input.leadId,
      portalKey: 'analytics-portal',
      bitrixDealId: `deal-${id}`,
      title: `Deal ${id}`,
      amount: input.amount === undefined ? '1000000' : input.amount,
      currency: input.currency === undefined ? 'VND' : input.currency,
      pipelineId: '1',
      stageId: 'C1:NEW',
      stageSemantics: input.stageSemantics ?? 'open',
      stageDeletedAt: input.deletedAt ?? null,
      probability: 10,
      assignedTo: null,
      ruleRevision: 1,
      conversionStatus: input.conversionStatus ?? 'completed',
      remoteModifiedAt: null,
      everWonAt: input.everWonAt ?? null,
      currentSnapshotHash: null,
      version: 1,
    });
    return id;
  }

  async function saveDealHistory(dealId: string, semantics: string, amount: string) {
    await dataSource.getRepository(DealHistoryEntity).save({
      id: uuidv7(),
      dealId,
      previousStageId: null,
      currentStageId: `stage-${semantics}`,
      previousSemantics: null,
      currentSemantics: semantics,
      amount,
      currency: 'VND',
      providerRevisionKey: randomUUID(),
      observedAt: new Date(),
      effectiveAt: new Date(),
      sourceComplete: true,
    });
  }

  async function saveSubmission(input: SubmissionFixture): Promise<string> {
    const id = uuidv7();
    const eventId = uuidv7();
    const advertiserId = input.advertiserId ?? defaultAdvertiserId;
    await dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'analytics-scope',
      advertiserId,
      portalKey: null,
      eventKey: `event-${id}`,
      eventType: 'lead.generate',
      occurredAt: input.occurredAt,
      receivedAt: input.occurredAt,
      rawBody: Buffer.from('{}'),
      payload: {},
      payloadHash: 'b'.repeat(64),
      status: 'processed',
      errorCode: null,
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id,
      advertiserId,
      providerMode: 'mock',
      leadId: input.leadId,
      eventId,
      providerLeadId: null,
      submissionKey: `submission-${id}`,
      campaignId: input.campaignId === undefined ? 'cmp-1' : input.campaignId,
      campaignName: null,
      adId: null,
      adName: null,
      formId: null,
      formName: null,
      ttclid: null,
      utm: {},
      customAnswers: {},
      engagement: { event: input.event ?? 'form_complete' },
      consent: {},
      occurredAt: input.occurredAt,
      isHistorical: input.isHistorical ?? false,
      applyRules: input.applyRules ?? true,
      sendFeedback: true,
      payloadHash: 'c'.repeat(64),
      associationStatus: input.leadId ? 'linked' : 'unmatched',
      linkAttemptCount: 0,
      nextLinkAttemptAt: null,
      associationExpiresAt: null,
    });
    return id;
  }

  return { saveLead, saveDeal, saveDealHistory, saveSubmission };
}
