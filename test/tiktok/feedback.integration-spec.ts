import { createHash, randomUUID } from 'node:crypto';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import { FeedbackLedgerEntity } from '@modules/crm-integration/entities/feedback-ledger.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { ConversionFeedbackService } from '@modules/tiktok/services/conversion-feedback.service.js';
import { FeedbackRepository } from '@modules/crm-integration/repositories/feedback.repository.js';
import { MockTiktokAdapter } from '@modules/tiktok/adapters/mock-tiktok.adapter.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

describe('TikTok conversion feedback ledger', () => {
  let infrastructure: TestInfrastructure;
  let server: ProviderServer;
  let tiktokStore: TiktokStore;
  let feedback: ConversionFeedbackService;
  let configurationRevision = 0;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    tiktokStore = new TiktokStore();
    server = new ProviderServer({ bitrix: new BitrixStore(), tiktok: tiktokStore });
    await server.listen();
    feedback = new ConversionFeedbackService(
      infrastructure.database.dataSource,
      new ConfigurationRepository(infrastructure.database.dataSource),
      new OperationRepository(),
      new OutboxRepository(),
      new MockTiktokAdapter(server.tiktokBaseUrl, 'mock-api-key', 'mock-webhook-secret', 30),
      new FeedbackRepository(),
    );
    await storeRules();
  });

  afterAll(async () => {
    await server.close();
    await infrastructure.close();
  });

  it('records missing or false consent as skipped and makes zero provider calls', async () => {
    const noConsentLead = await createLead({ consent: {} });
    const falseConsentLead = await createLead({ consent: { crm_feedback_allowed: false } });
    const importedLead = await createLead({
      consent: { crm_feedback_allowed: true },
      isHistorical: true,
      sendFeedback: false,
    });
    await schedule(noConsentLead.id);
    await schedule(falseConsentLead.id);
    await schedule(importedLead.id);

    expect(
      await infrastructure.database.dataSource.getRepository(FeedbackLedgerEntity).find({
        where: { milestone: 'lead_qualified' },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ leadId: noConsentLead.id, status: 'skipped_no_consent' }),
        expect.objectContaining({ leadId: falseConsentLead.id, status: 'skipped_no_consent' }),
        expect.objectContaining({ leadId: importedLead.id, status: 'skipped_no_consent' }),
      ]),
    );
    expect(tiktokStore.calls).toHaveLength(0);
    expect(await infrastructure.database.dataSource.getRepository(OutboxEntity).count()).toBe(0);
  });

  it('queues mapped consented feedback with minimal detail and accepts it through the mock API', async () => {
    const { id: leadId } = await createLead({
      consent: { crm_feedback_allowed: true },
      email: 'Person@Example.com',
      phone: '+84901234567',
      customAnswers: { privateAnswer: 'never transmit' },
    });
    await schedule(leadId);

    const ledger = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .findOneByOrFail({ leadId, milestone: 'lead_qualified' });
    if (!ledger.operationId) throw new Error('feedback operation was not stored');
    const operation = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: ledger.operationId });
    expect(operation.operationKey).toBe(`feedback/advertiser-test/${leadId}/lead_qualified`);
    expect(operation.payload).toMatchObject({
      feedbackLedgerId: ledger.id,
      eventId: ledger.eventId,
    });
    expect(await infrastructure.database.dataSource.getRepository(OutboxEntity).count()).toBe(1);
    expect(JSON.stringify(ledger.detail)).not.toContain('never transmit');
    expect(JSON.stringify(ledger.detail)).not.toContain('Person@Example.com');

    await expect(feedback.send(operation.id, context(operation.id))).resolves.toMatchObject({
      outcome: 'succeeded',
      remoteId: ledger.eventId,
    });
    await expect(
      infrastructure.database.dataSource
        .getRepository(FeedbackLedgerEntity)
        .findOneByOrFail({ id: ledger.id }),
    ).resolves.toMatchObject({ status: 'accepted', lastErrorCode: null });
    expect(tiktokStore.calls[0]?.payload).toMatchObject({
      events: [{ eventId: ledger.eventId, payload: { event: 'QualifiedLead' } }],
    });
  });

  it('retains rejected event errors and retries with the same remote event ID', async () => {
    const { id: leadId } = await createLead({ consent: { crm_feedback_allowed: true } });
    await schedule(leadId);
    const ledger = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .findOneByOrFail({ leadId, milestone: 'lead_qualified' });
    if (!ledger.operationId) throw new Error('feedback operation was not stored');
    const operation = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: ledger.operationId });
    const callsBefore = tiktokStore.calls.length;
    tiktokStore.setNextFeedbackResult([
      { eventId: ledger.eventId, status: 'rejected', errorCode: 'POLICY_REJECTED' },
    ]);

    await expect(feedback.send(operation.id, context(operation.id))).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'POLICY_REJECTED',
    });
    await expect(
      infrastructure.database.dataSource
        .getRepository(FeedbackLedgerEntity)
        .findOneByOrFail({ id: ledger.id }),
    ).resolves.toMatchObject({ status: 'rejected', lastErrorCode: 'POLICY_REJECTED' });
    await expect(feedback.send(operation.id, context(operation.id))).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(
      tiktokStore.calls
        .slice(callsBefore)
        .map((call) => (call.payload as { events: Array<{ eventId: string }> }).events[0]?.eventId),
    ).toEqual([ledger.eventId, ledger.eventId]);
  });

  it('returns retry_wait for mock 429 and timeout faults', async () => {
    const rateLimited = await createQueuedLead();
    tiktokStore.injectFault('feedback', 'rate_limit');
    await expect(
      feedback.send(rateLimited.operation.id, context(rateLimited.operation.id)),
    ).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'RATE_LIMITED',
    });

    const timedOut = await createQueuedLead();
    tiktokStore.injectFault('feedback', 'timeout_without_persist');
    await expect(
      feedback.send(timedOut.operation.id, context(timedOut.operation.id)),
    ).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('deduplicates won, reopen, won scheduling by advertiser, lead and milestone', async () => {
    const { id: leadId } = await createLead({ consent: { crm_feedback_allowed: true } });
    await schedule(leadId, 'deal_won');
    await schedule(leadId, 'deal_created');
    await schedule(leadId, 'deal_won');
    const ledgers = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .find({ where: { leadId } });
    expect(ledgers.filter((item) => item.milestone === 'deal_won')).toHaveLength(1);
    expect(ledgers.find((item) => item.milestone === 'deal_won')?.eventId).toBe(
      createHash('sha256')
        .update('advertiser-test\0' + leadId + '\0deal_won')
        .digest('hex'),
    );
  });

  it('keeps the consent given on the lead form after a later interaction without one', async () => {
    const { id: leadId } = await createLead({ consent: { crm_feedback_allowed: true } });
    await addSubmission(leadId, {});
    await schedule(leadId);

    const ledger = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .findOneByOrFail({ leadId, milestone: 'lead_qualified' });
    expect(ledger.status).not.toBe('skipped_no_consent');
    expect(ledger.operationId).not.toBeNull();
  });

  it('honors consent withdrawn on a later lead form', async () => {
    const { id: leadId } = await createLead({ consent: { crm_feedback_allowed: true } });
    await addSubmission(leadId, { crm_feedback_allowed: false });
    await schedule(leadId);

    await expect(
      infrastructure.database.dataSource
        .getRepository(FeedbackLedgerEntity)
        .findOneByOrFail({ leadId, milestone: 'lead_qualified' }),
    ).resolves.toMatchObject({ status: 'skipped_no_consent', operationId: null });
  });

  it('sends feedback for an imported lead only when the operator enabled it', async () => {
    const { id: leadId } = await createLead({
      consent: { crm_feedback_allowed: true },
      isHistorical: true,
      sendFeedback: true,
    });
    await schedule(leadId);

    const ledger = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .findOneByOrFail({ leadId, milestone: 'lead_qualified' });
    expect(ledger.status).not.toBe('skipped_no_consent');
  });

  async function createQueuedLead() {
    const { id } = await createLead({ consent: { crm_feedback_allowed: true } });
    await schedule(id);
    const ledger = await infrastructure.database.dataSource
      .getRepository(FeedbackLedgerEntity)
      .findOneByOrFail({ leadId: id, milestone: 'lead_qualified' });
    if (!ledger.operationId) throw new Error('feedback operation was not stored');
    const operation = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: ledger.operationId });
    return { ledger, operation };
  }

  async function createLead(input: {
    consent: Record<string, unknown>;
    email?: string;
    phone?: string;
    customAnswers?: Record<string, unknown>;
    isHistorical?: boolean;
    sendFeedback?: boolean;
  }): Promise<LeadEntity> {
    const id = randomUUID();
    const now = new Date();
    const eventId = randomUUID();
    await infrastructure.database.dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'scope-test',
      advertiserId: 'advertiser-test',
      portalKey: null,
      eventKey: `event-${id}`,
      eventType: 'lead.generate',
      occurredAt: now,
      receivedAt: now,
      rawBody: Buffer.from('{}'),
      payload: {},
      payloadHash: 'b'.repeat(64),
      status: 'processed',
      errorCode: null,
    });
    const lead = await infrastructure.database.dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `external-${id}`,
      advertiserId: 'advertiser-test',
      scopeKey: 'scope-test',
      portalKey: 'portal-test',
      providerMode: 'mock',
      name: `Lead ${id}`,
      email: input.email ?? null,
      phone: input.phone ?? null,
      city: null,
      interests: [],
      score: 80,
      scoreVersion: 1,
      scoreBreakdown: {},
      businessStatus: 'new',
      syncStatus: 'synced',
      bitrixLeadId: null,
      firstSubmissionId: null,
      lastSubmissionId: null,
      firstTouchAt: now,
      firstTouchCampaignId: null,
      lastTouchAt: now,
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version: 1,
      lastErrorCode: null,
    });
    const submission = await infrastructure.database.dataSource
      .getRepository(SubmissionEntity)
      .save({
        id: randomUUID(),
        advertiserId: 'advertiser-test',
        providerMode: 'mock',
        leadId: lead.id,
        eventId,
        providerLeadId: null,
        submissionKey: `submission-${id}`,
        campaignId: null,
        campaignName: null,
        adId: null,
        adName: null,
        formId: null,
        formName: null,
        ttclid: 'click-1',
        utm: {},
        customAnswers: input.customAnswers ?? {},
        engagement: {},
        consent: input.consent,
        occurredAt: now,
        isHistorical: input.isHistorical ?? false,
        applyRules: true,
        sendFeedback: input.sendFeedback ?? true,
        payloadHash: 'a'.repeat(64),
        associationStatus: 'linked',
        linkAttemptCount: 0,
        nextLinkAttemptAt: null,
        associationExpiresAt: null,
      });
    await infrastructure.database.dataSource.getRepository(LeadEntity).update(lead.id, {
      firstSubmissionId: submission.id,
      lastSubmissionId: submission.id,
    });
    return lead;
  }

  async function addSubmission(leadId: string, consent: Record<string, unknown>): Promise<void> {
    const eventId = randomUUID();
    const occurredAt = new Date(Date.now() + 60_000);
    await infrastructure.database.dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'scope-test',
      advertiserId: 'advertiser-test',
      portalKey: null,
      eventKey: `event-${eventId}`,
      eventType: 'user.interaction',
      occurredAt,
      receivedAt: occurredAt,
      rawBody: Buffer.from('{}'),
      payload: {},
      payloadHash: 'c'.repeat(64),
      status: 'processed',
      errorCode: null,
    });
    await infrastructure.database.dataSource.getRepository(SubmissionEntity).save({
      id: randomUUID(),
      advertiserId: 'advertiser-test',
      providerMode: 'mock',
      leadId,
      eventId,
      providerLeadId: null,
      submissionKey: `submission-${eventId}`,
      campaignId: null,
      campaignName: null,
      adId: null,
      adName: null,
      formId: null,
      formName: null,
      ttclid: null,
      utm: {},
      customAnswers: {},
      engagement: {},
      consent,
      occurredAt,
      isHistorical: false,
      applyRules: true,
      sendFeedback: true,
      payloadHash: 'd'.repeat(64),
      associationStatus: 'linked',
      linkAttemptCount: 0,
      nextLinkAttemptAt: null,
      associationExpiresAt: null,
    });
  }

  async function schedule(
    leadId: string,
    milestone: 'lead_qualified' | 'deal_created' | 'deal_won' = 'lead_qualified',
  ) {
    await infrastructure.database.dataSource.transaction((manager) =>
      feedback.schedule(leadId, milestone, manager),
    );
  }

  async function storeRules(): Promise<void> {
    configurationRevision += 1;
    const config = {
      schema_version: 1,
      feedback: {
        enabled: true,
        event_mapping: {
          lead_qualified: 'QualifiedLead',
          deal_created: 'DealCreated',
          deal_won: 'DealWon',
        },
        matching_keys: ['email', 'phone', 'ttclid'],
        hash_email: true,
        hash_phone: true,
      },
    };
    await infrastructure.database.dataSource.getRepository(ConfigurationEntity).save({
      id: randomUUID(),
      key: 'rules',
      revision: configurationRevision,
      value: { config, compiled: null },
      createdBy: null,
    });
    await infrastructure.database.dataSource
      .getRepository(ConfigurationHeadEntity)
      .save({ key: 'rules', revision: configurationRevision });
  }

  function context(operationId: string): OperationContext {
    return {
      operationId,
      ownerToken: randomUUID(),
      attempt: 1,
      revisions: { rules: configurationRevision },
      signal: new AbortController().signal,
      assertOwnership: async () => {},
      acquireAggregateLease: () => Promise.resolve(null),
      releaseAggregateLease: () => Promise.resolve(true),
    };
  }
});
