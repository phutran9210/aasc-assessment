import { createHash, randomUUID } from 'node:crypto';

import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { LeadIdentityEntity } from '@modules/crm-integration/entities/lead-identity.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { LeadIdentityRepository } from '@modules/crm-integration/repositories/lead-identity.repository.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import { LeadIngestService } from '@modules/crm-integration/services/lead-ingest.service.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

describe('TikTok lead ingestion', () => {
  let infrastructure: TestInfrastructure;
  let ingest: LeadIngestService;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    ingest = new LeadIngestService(
      infrastructure.database.dataSource,
      new LeadRepository(),
      new LeadIdentityRepository(),
      new SubmissionRepository(),
      new OperationRepository(),
      new OutboxRepository(),
      new WebhookEventRepository(),
      new ConfigurationRepository(infrastructure.database.dataSource),
      new AnalyticsRevisionRepository(),
      'portal-test',
      'VN',
    );
  });

  afterAll(async () => infrastructure.close());

  it('deduplicates concurrent events by email and phone while retaining every submission', async () => {
    const advertiserId = `advertiser-${randomUUID()}`;
    const eventIds = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        saveLeadEvent(
          advertiserId,
          {
            full_name: `Nguyen ${index}`,
            email: 'Ada+intake@example.test',
            phone_number: '+84901234567',
          },
          index,
        ),
      ),
    );
    const outcomes = await Promise.all(
      eventIds.map((eventId) => ingest.process(eventId, context())),
    );

    expect(outcomes.every((outcome) => outcome.outcome === 'succeeded')).toBe(true);
    expect(
      await infrastructure.database.dataSource
        .getRepository(LeadEntity)
        .count({ where: { advertiserId } }),
    ).toBe(1);
    expect(
      await infrastructure.database.dataSource
        .getRepository(SubmissionEntity)
        .count({ where: { advertiserId } }),
    ).toBe(20);
    expect(
      await infrastructure.database.dataSource
        .getRepository(LeadIdentityEntity)
        .count({ where: { advertiserId } }),
    ).toBe(2);
  });

  it('quarantines cross-lead email and phone matches without transferring either identity', async () => {
    const advertiserId = `advertiser-${randomUUID()}`;
    const first = await saveLeadEvent(
      advertiserId,
      { full_name: 'Lead A', email: 'a@example.test', phone_number: '+84901111111' },
      1,
    );
    const second = await saveLeadEvent(
      advertiserId,
      { full_name: 'Lead B', email: 'b@example.test', phone_number: '+84902222222' },
      2,
    );
    await ingest.process(first, context());
    await ingest.process(second, context());
    const conflict = await saveLeadEvent(
      advertiserId,
      { full_name: 'Conflict', email: 'a@example.test', phone_number: '+84902222222' },
      3,
    );

    await expect(ingest.process(conflict, context())).resolves.toMatchObject({
      outcome: 'quarantined',
      errorCode: 'IDENTITY_CONFLICT',
    });
    const identities = await infrastructure.database.dataSource
      .getRepository(LeadIdentityEntity)
      .find({ where: { advertiserId } });
    expect(
      identities.find(
        (identity) =>
          identity.identityType === 'phone' && identity.normalizedValue === '+84902222222',
      )?.leadId,
    ).not.toBe(
      identities.find(
        (identity) =>
          identity.identityType === 'email' && identity.normalizedValue === 'a@example.test',
      )?.leadId,
    );
  });

  it('keeps form events pending and links them when the lead becomes known', async () => {
    const advertiserId = `advertiser-${randomUUID()}`;
    const providerLeadId = `provider-${randomUUID()}`;
    const associationEventId = await saveAssociationEvent(advertiserId, providerLeadId);
    await expect(ingest.process(associationEventId, context())).resolves.toMatchObject({
      outcome: 'awaiting_link',
    });
    const leadEventId = await saveLeadEvent(
      advertiserId,
      {
        full_name: 'Pending Lead',
        email: 'pending@example.test',
        phone_number: '+84903333333',
      },
      10,
      providerLeadId,
    );
    await expect(ingest.process(leadEventId, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    const leadSubmissions = await infrastructure.database.dataSource
      .getRepository(SubmissionEntity)
      .find({ where: { advertiserId } });
    expect(
      leadSubmissions.map(({ providerLeadId: id, associationStatus }) => ({
        id,
        associationStatus,
      })),
    ).toContainEqual({ id: providerLeadId, associationStatus: 'linked' });
    await ingest.process(associationEventId, context());

    const association = await infrastructure.database.dataSource
      .getRepository(SubmissionEntity)
      .findOneByOrFail({ eventId: associationEventId });
    expect(association.associationStatus).toBe('linked');
    expect(association.leadId).not.toBeNull();
    expect(association.nextLinkAttemptAt).toBeNull();
  });

  it('ingests with the revisions the webhook inbox records when no scoring policy is stored', async () => {
    const advertiserId = `advertiser-${randomUUID()}`;
    const eventId = await saveLeadEvent(
      advertiserId,
      { name: 'First Run', email: 'first-run@example.test' },
      0,
    );

    // The inbox stores 0 for every configuration key that has no revision yet.
    const outcome = await ingest.process(eventId, {
      ...context(),
      revisions: { mapping: 0, rules: 0, scoring: 0 },
    });

    expect(outcome).toMatchObject({ outcome: 'succeeded' });
    const lead = await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .findOneByOrFail({ advertiserId });
    expect(lead.scoreVersion).toBe(1);
  });

  it('quarantines a provider source key reused with changed lead content', async () => {
    const advertiserId = `advertiser-${randomUUID()}`;
    const providerLeadId = `provider-${randomUUID()}`;
    const first = await saveLeadEvent(
      advertiserId,
      {
        full_name: 'Original',
        email: 'original@example.test',
        phone_number: '+84904444444',
      },
      11,
      providerLeadId,
    );
    await ingest.process(first, context());
    const changed = await saveLeadEvent(
      advertiserId,
      {
        full_name: 'Changed',
        email: 'changed@example.test',
        phone_number: '+84905555555',
      },
      12,
      providerLeadId,
    );

    await expect(ingest.process(changed, context())).resolves.toMatchObject({
      outcome: 'quarantined',
      errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT',
    });
  });

  async function saveLeadEvent(
    advertiserId: string,
    leadData: Record<string, string>,
    index: number,
    providerLeadId?: string,
  ): Promise<string> {
    const eventKey = `lead-ingest-${randomUUID()}-${index}`;
    const payload = {
      event_id: eventKey,
      event: 'lead.generate',
      advertiser_id: advertiserId,
      timestamp: new Date(Date.now() + index).toISOString(),
      provider_lead_id: providerLeadId ?? `provider-${eventKey}`,
      lead_data: leadData,
      campaign_id: 'campaign-1',
      form_id: 'form-1',
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const event = infrastructure.database.dataSource.getRepository(WebhookEventEntity).create({
      id: randomUUID(),
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: advertiserId,
      advertiserId,
      portalKey: null,
      eventKey,
      eventType: 'lead.generate',
      occurredAt: new Date(payload.timestamp),
      receivedAt: new Date(),
      rawBody,
      payload,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      status: 'received',
      errorCode: null,
    });
    return (await infrastructure.database.dataSource.getRepository(WebhookEventEntity).save(event))
      .id;
  }

  async function saveAssociationEvent(
    advertiserId: string,
    providerLeadId: string,
  ): Promise<string> {
    const eventKey = `form-${randomUUID()}`;
    const payload = {
      event_id: eventKey,
      event: 'form.complete',
      advertiser_id: advertiserId,
      timestamp: new Date().toISOString(),
      provider_lead_id: providerLeadId,
      form_id: 'form-1',
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const event = infrastructure.database.dataSource.getRepository(WebhookEventEntity).create({
      id: randomUUID(),
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: advertiserId,
      advertiserId,
      portalKey: null,
      eventKey,
      eventType: 'form.complete',
      occurredAt: new Date(payload.timestamp),
      receivedAt: new Date(),
      rawBody,
      payload,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      status: 'received',
      errorCode: null,
    });
    return (await infrastructure.database.dataSource.getRepository(WebhookEventEntity).save(event))
      .id;
  }
});

function context(): OperationContext {
  return {
    operationId: randomUUID(),
    ownerToken: randomUUID(),
    attempt: 1,
    revisions: { mapping: 1, rules: 0, scoring: 1 },
    signal: new AbortController().signal,
    assertOwnership: () => Promise.resolve(),
    acquireAggregateLease: () => Promise.resolve(null),
    releaseAggregateLease: () => Promise.resolve(true),
  };
}
