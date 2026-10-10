import { GatewayTimeoutException, UnprocessableEntityException } from '@nestjs/common';

import { ConversionService } from '../services/conversion.service.js';

function setup() {
  const manager = {};
  const dataSource = {
    manager,
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const operation = {
    id: 'operation-1',
    operationKey: 'convert/lead-1',
    payload: { leadId: 'lead-1', dealId: 'deal-1', reconciliationAttempt: 0 },
    targetVersion: 1,
    configRevisions: { rules: 1 },
    actorId: null,
  };
  const deal = {
    id: 'deal-1',
    leadId: 'lead-1',
    version: 1,
    conversionStatus: 'pending',
    bitrixDealId: null as string | null,
    title: 'TikTok deal',
    pipelineId: '1',
    stageId: 'C1:NEW',
    assignedTo: 'sales-1',
    probability: 20,
  };
  const lead = {
    id: 'lead-1',
    bitrixLeadId: 'crm-lead-1',
    syncStatus: 'synced',
  };
  const remote = { id: 'crm-deal-1', marker: 'aasc-tiktok/deal/deal-1', fields: {} };
  const configurations = { findActive: jest.fn() };
  const assignments = { reserve: jest.fn() };
  const operations = {
    findById: jest.fn().mockResolvedValue(operation),
    ensure: jest.fn().mockResolvedValue({ id: 'retry-operation-1' }),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const gateway = {
    findDeals: jest.fn().mockResolvedValue([]),
    createDeal: jest.fn().mockResolvedValue(remote),
    completeLead: jest.fn().mockResolvedValue({ id: 'crm-lead-1' }),
  };
  const reconciliation = { find: jest.fn().mockResolvedValue({ status: 'not_found' }) };
  const timeline = { append: jest.fn().mockResolvedValue('timeline-1') };
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const submissions = { findLatestForLead: jest.fn() };
  const deals = {
    findById: jest.fn().mockResolvedValue(deal),
    findByIdForUpdate: jest.fn().mockResolvedValue(deal),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const analytics = { increment: jest.fn().mockResolvedValue(undefined) };
  const feedback = { schedule: jest.fn().mockResolvedValue(undefined) };
  const context = {
    acquireAggregateLease: jest.fn().mockResolvedValue('lease-1'),
    assertOwnership: jest.fn().mockResolvedValue(undefined),
    releaseAggregateLease: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ConversionService(
    dataSource as never,
    configurations as never,
    assignments as never,
    operations as never,
    outbox as never,
    gateway as never,
    reconciliation as never,
    timeline as never,
    leads as never,
    submissions as never,
    deals as never,
    analytics,
    feedback,
  );
  return {
    service,
    operation,
    deal,
    lead,
    remote,
    operations,
    outbox,
    gateway,
    reconciliation,
    timeline,
    leads,
    deals,
    analytics,
    feedback,
    context,
  };
}

describe('ConversionService execute', () => {
  it('quarantines missing operation scope before acquiring the aggregate lease', async () => {
    const { service, operations, context } = setup();
    operations.findById.mockResolvedValueOnce(null);

    await expect(service.execute('missing', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CONVERSION_PAYLOAD_INVALID',
    });
    expect(context.acquireAggregateLease).not.toHaveBeenCalled();
  });

  it('defers conversion when another worker owns the lead lease', async () => {
    const { service, context, gateway } = setup();
    context.acquireAggregateLease.mockResolvedValueOnce(null);

    await expect(service.execute('operation-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CONVERSION_LEASE_BUSY',
      deferred: true,
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('quarantines a missing local deal and releases its lease', async () => {
    const { service, deals, context } = setup();
    deals.findById.mockResolvedValueOnce(null);

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CONVERSION_AGGREGATE_MISSING',
    });
    expect(context.releaseAggregateLease).toHaveBeenCalledWith('lease-1');
  });

  it('returns the completed CRM deal without creating another one', async () => {
    const { service, deal, gateway, context } = setup();
    deal.conversionStatus = 'completed';
    deal.bitrixDealId = 'crm-deal-1';

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: 'crm-deal-1',
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('refuses conversion while the lead has not been synced', async () => {
    const { service, lead, gateway, context } = setup();
    lead.syncStatus = 'pending';

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'LEAD_NOT_SYNCED',
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('quarantines an ambiguous deal marker without attempting another create', async () => {
    const { service, reconciliation, deals, gateway, context } = setup();
    reconciliation.find.mockResolvedValueOnce({ status: 'ambiguous' });

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'DEAL_MARKER_AMBIGUOUS',
    });
    expect(deals.update).toHaveBeenCalledWith(
      'deal-1',
      { conversionStatus: 'reconcile_required' },
      expect.anything(),
    );
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('quarantines a lead that already has multiple linked CRM deals', async () => {
    const { service, gateway, context } = setup();
    gateway.findDeals.mockResolvedValueOnce([{ id: 'one' }, { id: 'two' }]);

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'LEAD_HAS_MULTIPLE_DEALS',
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('requires reconciliation instead of repeating a create already attempted', async () => {
    const { service, deal, gateway, context } = setup();
    deal.conversionStatus = 'creating_deal';

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'DEAL_CREATE_ALREADY_ATTEMPTED',
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('schedules a read-only lookup for an ambiguous prior create', async () => {
    const { service, deal, operations, outbox, gateway, context } = setup();
    deal.conversionStatus = 'reconcile_required';

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'DEAL_CREATE_AMBIGUOUS',
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'convert/lead-1/reconcile/1/1',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });

  it('stops scheduling read-only lookups after the retry budget is exhausted', async () => {
    const { service, deal, operation, outbox, context } = setup();
    deal.conversionStatus = 'reconcile_required';
    operation.operationKey = 'convert/lead-1/reconcile/1/3';
    operation.payload.reconciliationAttempt = 3;

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'DEAL_RECONCILIATION_EXHAUSTED',
    });
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('retries a refused create without requiring operator reconciliation', async () => {
    const { service, gateway, deals, context } = setup();
    gateway.createDeal.mockRejectedValueOnce(new UnprocessableEntityException());

    await expect(service.execute('operation-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'DEAL_CREATE_REJECTED',
    });
    expect(deals.update).toHaveBeenCalledWith(
      'deal-1',
      { conversionStatus: 'retry_wait' },
      expect.anything(),
    );
  });

  it('requires reconciliation when a create timed out and no deal can be found', async () => {
    const { service, gateway, reconciliation, operations, context } = setup();
    gateway.createDeal.mockRejectedValueOnce(new GatewayTimeoutException());

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'DEAL_CREATE_AMBIGUOUS',
    });
    expect(reconciliation.find).toHaveBeenCalledTimes(2);
    expect(operations.ensure).toHaveBeenCalledTimes(1);
  });

  it('adopts a CRM deal found by marker after a create timeout', async () => {
    const { service, remote, gateway, reconciliation, deals, context } = setup();
    gateway.createDeal.mockRejectedValueOnce(new GatewayTimeoutException());
    reconciliation.find
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockResolvedValueOnce({ status: 'found', value: remote });

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: 'crm-deal-1',
    });
    expect(deals.update).toHaveBeenCalledWith(
      'deal-1',
      { bitrixDealId: 'crm-deal-1', conversionStatus: 'deal_created' },
      expect.anything(),
    );
  });

  it('persists the created CRM deal, completes the lead, and records a timeline', async () => {
    const { service, gateway, leads, deals, analytics, timeline, feedback, context } = setup();

    await expect(service.execute('operation-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: 'crm-deal-1',
    });
    expect(gateway.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'crm-lead-1', stageId: 'C1:NEW' }),
      'aasc-tiktok/deal/deal-1',
    );
    expect(gateway.completeLead).toHaveBeenCalledWith('crm-lead-1', 'CONVERTED');
    expect(leads.update.mock.calls).toEqual(
      expect.arrayContaining([
        ['lead-1', expect.objectContaining({ businessStatus: 'converted' }), expect.anything()],
      ]),
    );
    expect(deals.update.mock.calls).toEqual(
      expect.arrayContaining([
        ['deal-1', expect.objectContaining({ conversionStatus: 'completed' }), expect.anything()],
      ]),
    );
    expect(analytics.increment).toHaveBeenCalledTimes(1);
    expect(timeline.append).toHaveBeenCalledTimes(1);
    expect(feedback.schedule).toHaveBeenCalledWith('lead-1', 'deal_created', expect.anything());
  });

  it('retries lead completion without creating another CRM deal', async () => {
    const { service, deal, gateway, context } = setup();
    deal.bitrixDealId = 'crm-deal-1';
    gateway.completeLead.mockRejectedValueOnce(new Error('temporary failure'));

    await expect(service.execute('operation-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'LEAD_COMPLETION_FAILED',
    });
    expect(gateway.createDeal).not.toHaveBeenCalled();
  });
});
