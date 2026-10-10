import {
  LeadIngestService,
  scoreVersionOf,
  toProviderLead,
} from '../services/lead-ingest.service.js';

function setup() {
  const manager = {};
  const event = {
    id: 'event-1',
    provider: 'tiktok',
    providerMode: 'mock',
    advertiserId: 'advertiser-1',
    scopeKey: 'advertiser-1',
    eventKey: 'event-key-1',
    eventType: 'user.interaction',
    occurredAt: new Date('2026-10-01T00:00:00Z'),
    receivedAt: new Date('2026-10-01T00:00:01Z'),
    payloadHash: 'hash-1',
    payload: { provider_lead_id: 'provider-1', interaction_type: 'click' } as Record<
      string,
      unknown
    >,
  };
  const lead = {
    id: 'lead-1',
    advertiserId: 'advertiser-1',
    version: 1,
    email: 'an@example.test',
    phone: null,
    score: 0,
    scoreBreakdown: {},
    lastTouchAt: null as Date | null,
    lastSubmissionId: null as string | null,
  };
  const submission = {
    id: 'submission-1',
    eventId: event.id,
    leadId: null as string | null,
    payloadHash: event.payloadHash,
    associationStatus: 'waiting_link',
    associationExpiresAt: new Date(Date.now() + 60_000) as Date | null,
    linkAttemptCount: 0,
    nextLinkAttemptAt: new Date(Date.now() + 5_000) as Date | null,
  };
  const dataSource = {
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    withIdentityLocks: jest.fn((_: unknown, callback: () => Promise<unknown>) => callback()),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const identities = {
    findByValues: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const submissions = {
    findLatestByProviderLeadId: jest.fn().mockResolvedValue(null),
    findByKey: jest.fn().mockResolvedValue(null),
    findForLead: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const operations = { ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const webhookEvents = {
    findById: jest.fn().mockResolvedValue(event),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const configurations = { findRevision: jest.fn().mockResolvedValue(null) };
  const analytics = { increment: jest.fn().mockResolvedValue(undefined) };
  const feedback = { schedule: jest.fn().mockResolvedValue(undefined) };
  const context = {
    assertOwnership: jest.fn().mockResolvedValue(undefined),
    revisions: { rules: 0, scoring: 0, mapping: 0 },
  };
  const service = new LeadIngestService(
    dataSource as never,
    leads as never,
    identities as never,
    submissions as never,
    operations as never,
    outbox as never,
    webhookEvents as never,
    configurations as never,
    analytics,
    'portal-1',
    'VN',
    feedback,
  );
  return {
    service,
    event,
    lead,
    submission,
    leads,
    identities,
    submissions,
    operations,
    outbox,
    webhookEvents,
    configurations,
    analytics,
    feedback,
    context,
  };
}

describe('lead ingest event boundaries', () => {
  it('falls back to the event scope and payload timestamp for provider normalization', () => {
    const result = toProviderLead(
      {
        payload: {
          provider_lead_id: '  provider-1  ',
          timestamp: '2026-10-01T00:00:00Z',
          lead_data: { custom_questions: [{ question_id: 'q1', answer: 'A' }] },
        },
        advertiserId: null,
        scopeKey: 'scope-1',
        eventKey: 'event-1',
        occurredAt: null,
      },
      { applyRules: false, sendFeedback: false },
    );

    expect(result).toMatchObject({
      id: 'provider-1',
      advertiserId: 'scope-1',
      occurredAt: '2026-10-01T00:00:00Z',
      customQuestions: [{ question_id: 'q1', answer: 'A' }],
      isHistorical: true,
      applyRules: false,
      sendFeedback: false,
    });
  });

  it('uses the rules revision when scoring has no revision and never stores version zero', () => {
    expect(scoreVersionOf({ rules: 7, scoring: 0 })).toBe(7);
    expect(scoreVersionOf({ rules: 0, scoring: 0 })).toBe(1);
    expect(scoreVersionOf({ rules: 7, scoring: 9 })).toBe(9);
  });

  it('quarantines a missing event or one from another provider', async () => {
    const { service, webhookEvents, context } = setup();
    webhookEvents.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ provider: 'bitrix24' });

    await expect(service.process('missing', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'EVENT_NOT_FOUND',
    });
    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'EVENT_NOT_FOUND',
    });
  });

  it('marks an unsupported event type ignored without creating a submission', async () => {
    const { service, event, submissions, webhookEvents, context } = setup();
    event.eventType = 'campaign.update';

    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'EVENT_TYPE_UNSUPPORTED',
    });
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'ignored',
      expect.anything(),
    );
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('quarantines an association event whose idempotency key was reused with new content', async () => {
    const { service, submission, submissions, webhookEvents, context } = setup();
    submissions.findByKey.mockResolvedValueOnce({ ...submission, payloadHash: 'different' });

    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT',
    });
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'quarantined',
      expect.anything(),
      'SUBMISSION_KEY_CONTENT_CONFLICT',
    );
  });

  it('records an unlinked interaction and schedules a retry to find its lead', async () => {
    const { service, submissions, operations, outbox, context } = setup();

    const result = await service.process('event-1', context as never);

    expect(result).toMatchObject({ outcome: 'awaiting_link' });
    expect(submissions.create.mock.calls[0]?.[0]).toMatchObject({
      providerLeadId: 'provider-1',
      associationStatus: 'waiting_link',
      engagement: { event: 'click' },
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({ kind: 'tiktok_ingest' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('expires an association that never found a lead', async () => {
    const { service, submission, submissions, outbox, context } = setup();
    submission.associationExpiresAt = new Date(Date.now() - 1_000);
    submissions.findByKey.mockResolvedValueOnce(submission);

    await expect(service.process('event-1', context as never)).resolves.toMatchObject({
      outcome: 'unmatched',
      submissionId: 'submission-1',
    });
    expect(submissions.save.mock.calls[0]?.[0]).toMatchObject({
      associationStatus: 'unmatched',
      nextLinkAttemptAt: null,
    });
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('increments link attempts and schedules another lookup before expiry', async () => {
    const { service, submission, submissions, operations, context } = setup();
    submissions.findByKey.mockResolvedValueOnce(submission);

    await expect(service.process('event-1', context as never)).resolves.toMatchObject({
      outcome: 'awaiting_link',
    });
    expect(submissions.save.mock.calls[0]?.[0]).toMatchObject({ linkAttemptCount: 1 });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'tiktok-link/submission-1/2',
    });
  });

  it('links an interaction to the known lead and advances its score and version', async () => {
    const { service, lead, submission, submissions, leads, analytics, context } = setup();
    submissions.findLatestByProviderLeadId.mockResolvedValueOnce({ leadId: 'lead-1' });
    submissions.findByKey.mockResolvedValueOnce(submission);

    await expect(service.process('event-1', context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      leadId: 'lead-1',
    });
    expect(submissions.save.mock.calls[0]?.[0]).toMatchObject({
      leadId: 'lead-1',
      associationStatus: 'linked',
    });
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({ version: 2 });
    expect(analytics.increment).toHaveBeenCalledTimes(1);
    expect(lead.lastTouchAt).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('quarantines a lead event without a name before creating a submission', async () => {
    const { service, event, submissions, webhookEvents, context } = setup();
    event.eventType = 'lead.generate';
    event.payload = { provider_lead_id: 'provider-1', email: 'an@example.test' };

    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'NAME_MISSING',
    });
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'quarantined',
      expect.anything(),
      'NAME_MISSING',
    );
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('rejects a provider lead ID reused with different normalized content', async () => {
    const { service, event, submissions, context } = setup();
    event.eventType = 'lead.generate';
    event.payload = { provider_lead_id: 'provider-1', full_name: 'An', email: 'an@example.test' };
    submissions.findByKey.mockResolvedValueOnce({ id: 'submission-1', payloadHash: 'different' });

    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'SUBMISSION_KEY_CONTENT_CONFLICT',
    });
  });

  it('quarantines a lead whose email and phone identities belong to different leads', async () => {
    const { service, event, identities, submissions, context } = setup();
    event.eventType = 'lead.generate';
    event.payload = {
      provider_lead_id: 'provider-1',
      full_name: 'An',
      email: 'an@example.test',
      phone: '+84901234567',
    };
    identities.findByValues.mockResolvedValueOnce([{ leadId: 'lead-1' }, { leadId: 'lead-2' }]);

    await expect(service.process('event-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'IDENTITY_CONFLICT',
    });
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('refuses an operator-selected identity target from another advertiser', async () => {
    const { service, event, lead, context } = setup();
    event.eventType = 'lead.generate';
    event.payload = { provider_lead_id: 'provider-1', full_name: 'An', email: 'an@example.test' };
    lead.advertiserId = 'another-advertiser';

    await expect(service.process('event-1', context as never, 'lead-1')).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'IDENTITY_TARGET_SCOPE_MISMATCH',
    });
  });

  it('creates a new lead and one CRM sync operation for a valid first submission', async () => {
    const { service, event, leads, submissions, identities, operations, analytics, context } =
      setup();
    event.eventType = 'lead.generate';
    event.payload = { provider_lead_id: 'provider-1', full_name: 'An', email: 'an@example.test' };

    const result = await service.process('event-1', context as never);

    expect(result).toMatchObject({ outcome: 'succeeded', version: 1 });
    expect(leads.create.mock.calls[0]?.[0]).toMatchObject({
      name: 'An',
      advertiserId: 'advertiser-1',
      email: 'an@example.test',
      version: 1,
    });
    expect(submissions.save).toHaveBeenCalledTimes(2);
    expect(identities.save).toHaveBeenCalledTimes(1);
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({ kind: 'bitrix_lead_sync' });
    expect(analytics.increment).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule CRM sync for an old association with an unchanged score', async () => {
    const { service, lead, submission, submissions, operations, analytics, context } = setup();
    lead.score = 15;
    lead.scoreBreakdown = { email: 15, phone: 0, form: 0, interaction: 0, budget: 0, timeline: 0 };
    lead.lastTouchAt = new Date('2026-10-02T00:00:00Z');
    submissions.findLatestByProviderLeadId.mockResolvedValueOnce({ leadId: 'lead-1' });
    submissions.findByKey.mockResolvedValueOnce(submission);

    await expect(service.process('event-1', context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      leadId: 'lead-1',
      version: 1,
    });
    expect(operations.ensure).not.toHaveBeenCalled();
    expect(analytics.increment).not.toHaveBeenCalled();
  });

  it('uses the event scope when an association has no advertiser or provider lead ID', async () => {
    const { service, event, webhookEvents, submissions, context } = setup();
    webhookEvents.findById.mockResolvedValueOnce({
      ...event,
      advertiserId: null,
      occurredAt: null,
      payload: {
        campaign: { campaign_id: 'campaign-1', ad_id: 'ad-1' },
        form: { form_id: 'form-1' },
      },
    });

    await expect(service.process('event-1', context as never)).resolves.toMatchObject({
      outcome: 'awaiting_link',
    });
    expect(submissions.create.mock.calls[0]?.[0]).toMatchObject({
      advertiserId: 'advertiser-1',
      providerLeadId: null,
      campaignId: 'campaign-1',
      adId: 'ad-1',
      formId: 'form-1',
    });
  });
});
