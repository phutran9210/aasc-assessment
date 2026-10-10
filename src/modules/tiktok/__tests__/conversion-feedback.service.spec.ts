import { ProviderHttpError } from '../adapters/mock-tiktok.adapter.js';
import { ConversionFeedbackService } from '../services/conversion-feedback.service.js';

function setup() {
  const manager = {};
  const lead = {
    id: 'lead-1',
    advertiserId: 'advertiser-1',
    providerMode: 'mock',
    email: 'an@example.test',
    phone: null,
  };
  const submission = {
    sendFeedback: true,
    consent: { crm_feedback_allowed: true },
    ttclid: 'click-1',
  };
  const ledger = {
    id: 'ledger-1',
    advertiserId: 'advertiser-1',
    leadId: 'lead-1',
    eventId: 'event-1',
    status: 'queued',
    detail: { event: 'LeadQualified' },
    operationId: null as string | null,
  };
  const dataSource = { manager };
  const configurations = {
    findActive: jest.fn().mockResolvedValue({
      entity: { revision: 4 },
      value: {
        feedback: {
          enabled: true,
          event_mapping: { lead_qualified: 'LeadQualified' },
          matching_keys: ['email'],
        },
      },
    }),
  };
  const operations = {
    findById: jest.fn().mockResolvedValue({ payload: { feedbackLedgerId: 'ledger-1' } }),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-1', status: 'pending' }),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const provider = {
    sendEvents: jest.fn().mockResolvedValue([{ eventId: 'event-1', status: 'accepted' }]),
  };
  let scheduledLedger: Record<string, unknown> | null = null;
  const feedbackData = {
    findLeadContext: jest.fn().mockResolvedValue({ lead, submission }),
    ensureLedger: jest.fn((value: Record<string, unknown>) => {
      scheduledLedger = value;
      return Promise.resolve();
    }),
    findForUpdate: jest.fn(() => Promise.resolve(scheduledLedger)),
    findById: jest.fn().mockResolvedValue(ledger),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const context = { assertOwnership: jest.fn().mockResolvedValue(undefined) };
  const service = new ConversionFeedbackService(
    dataSource as never,
    configurations as never,
    operations as never,
    outbox as never,
    provider,
    feedbackData as never,
  );
  return {
    service,
    manager,
    lead,
    submission,
    ledger,
    configurations,
    operations,
    outbox,
    provider,
    feedbackData,
    context,
  };
}

describe('ConversionFeedbackService', () => {
  it('does not schedule feedback for a missing lead', async () => {
    const { service, feedbackData, manager } = setup();
    feedbackData.findLeadContext.mockResolvedValueOnce({ lead: null, submission: null });

    await service.schedule('missing', 'lead_qualified', manager as never);

    expect(feedbackData.ensureLedger).not.toHaveBeenCalled();
  });

  it('records missing consent without queuing an operation', async () => {
    const { service, submission, feedbackData, operations, manager } = setup();
    submission.consent.crm_feedback_allowed = false;

    await service.schedule('lead-1', 'lead_qualified', manager as never);

    expect(feedbackData.ensureLedger.mock.calls[0]?.[0]).toMatchObject({
      status: 'skipped_no_consent',
    });
    expect(operations.ensure).not.toHaveBeenCalled();
  });

  it('keeps feedback disabled until a rules policy exists', async () => {
    const { service, configurations, feedbackData, operations, manager } = setup();
    configurations.findActive.mockRejectedValueOnce(new Error('no rules'));

    await service.schedule('lead-1', 'lead_qualified', manager as never);

    expect(feedbackData.ensureLedger.mock.calls[0]?.[0]).toMatchObject({ status: 'disabled' });
    expect(operations.ensure).not.toHaveBeenCalled();
  });

  it('queues a consented feedback event with its policy revision', async () => {
    const { service, operations, feedbackData, outbox, manager } = setup();

    await service.schedule('lead-1', 'lead_qualified', manager as never);

    expect(feedbackData.ensureLedger.mock.calls[0]?.[0]).toMatchObject({ status: 'queued' });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      kind: 'tiktok_feedback',
      configRevisions: { rules: 4 },
    });
    expect(feedbackData.save.mock.calls[0]?.[0]).toMatchObject({ operationId: 'operation-1' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('quarantines a feedback operation without its ledger ID', async () => {
    const { service, operations, context, provider } = setup();
    operations.findById.mockResolvedValueOnce({ payload: {} });

    await expect(service.send('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'FEEDBACK_OPERATION_INVALID',
    });
    expect(provider.sendEvents).not.toHaveBeenCalled();
  });

  it('quarantines a ledger that no longer exists', async () => {
    const { service, feedbackData, context } = setup();
    feedbackData.findById.mockResolvedValueOnce(null);

    await expect(service.send('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'FEEDBACK_LEDGER_MISSING',
    });
  });

  it('does not send an already accepted or consent-skipped event twice', async () => {
    for (const status of ['accepted', 'skipped_no_consent']) {
      const { service, ledger, provider, context } = setup();
      ledger.status = status;
      await expect(service.send('operation-1', context as never)).resolves.toEqual({
        outcome: 'succeeded',
        remoteId: 'event-1',
      });
      expect(provider.sendEvents).not.toHaveBeenCalled();
    }
  });

  it('quarantines disabled feedback rather than sending it', async () => {
    const { service, ledger, provider, context } = setup();
    ledger.status = 'disabled';

    await expect(service.send('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'FEEDBACK_DISABLED',
    });
    expect(provider.sendEvents).not.toHaveBeenCalled();
  });

  it('marks a provider accepted event complete', async () => {
    const { service, provider, feedbackData, context } = setup();

    await expect(service.send('operation-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: 'event-1',
    });
    expect(provider.sendEvents).toHaveBeenCalledWith([
      { eventId: 'event-1', advertiserId: 'advertiser-1', payload: { event: 'LeadQualified' } },
    ]);
    expect(feedbackData.update).toHaveBeenCalledWith(
      'ledger-1',
      { status: 'accepted', lastErrorCode: null },
      expect.anything(),
    );
  });

  it('retries when the provider response omits the event result', async () => {
    const { service, provider, feedbackData, context } = setup();
    provider.sendEvents.mockResolvedValueOnce([]);

    await expect(service.send('operation-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'FEEDBACK_RESULT_MISSING',
    });
    expect(feedbackData.update).toHaveBeenCalledWith(
      'ledger-1',
      { status: 'rejected', lastErrorCode: 'FEEDBACK_RESULT_MISSING' },
      expect.anything(),
    );
  });

  it('persists a provider rejection code and returns a retry outcome', async () => {
    const { service, provider, feedbackData, context } = setup();
    provider.sendEvents.mockResolvedValueOnce([
      { eventId: 'event-1', status: 'rejected', errorCode: 'INVALID_EVENT' },
    ]);

    await expect(service.send('operation-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'INVALID_EVENT',
    });
    expect(feedbackData.update).toHaveBeenCalledWith(
      'ledger-1',
      { status: 'rejected', lastErrorCode: 'INVALID_EVENT' },
      expect.anything(),
    );
  });

  it('uses a longer retry delay after provider rate limiting', async () => {
    const { service, provider, context } = setup();
    provider.sendEvents.mockRejectedValueOnce(new ProviderHttpError(429, 'RATE_LIMIT'));
    const before = Date.now();

    const outcome = await service.send('operation-1', context as never);

    expect(outcome).toMatchObject({ outcome: 'retry_wait', errorCode: 'RATE_LIMIT' });
    if (outcome.outcome !== 'retry_wait') throw new Error('expected retry');
    expect(outcome.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(30_000);
  });
});
