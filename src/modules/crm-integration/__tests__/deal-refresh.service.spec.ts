import { NotFoundException } from '@nestjs/common';

import { DealRefreshService } from '../services/deal-refresh.service.js';

function setup() {
  const manager = {};
  const dataSource = {
    manager,
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const remote = {
    id: '42',
    title: 'Remote deal',
    marker: null,
    fields: {
      stageId: 'C1:NEW',
      categoryId: '1',
      updatedTime: '2026-10-01T00:00:00.000Z',
      opportunity: '500.0000',
      currencyId: 'VND',
      assignedById: '7',
      probability: 25,
    },
  };
  const deal = {
    id: 'deal-1',
    leadId: 'lead-1',
    bitrixDealId: '42' as string | null,
    title: 'Local deal',
    stageId: 'C1:NEW',
    stageSemantics: 'open',
    amount: '400.0000',
    currency: 'VND',
    remoteModifiedAt: null as Date | null,
    currentSnapshotHash: null as string | null,
    everWonAt: null as Date | null,
    stageDeletedAt: null as Date | null,
  };
  const event = {
    id: 'event-1',
    eventType: 'deal.update',
    eventKey: 'event-1',
    occurredAt: new Date('2026-10-01T00:00:00Z'),
  };
  const gateway = {
    getDeal: jest.fn().mockResolvedValue(remote),
    metadata: jest.fn().mockResolvedValue({
      stages: [
        { id: 'C1:NEW', categoryId: 1, semantic: null },
        { id: 'C1:WON', categoryId: 1, semantic: 'S' },
        { id: 'C1:LOST', categoryId: 1, semantic: 'F' },
      ],
    }),
  };
  const deals = {
    findByPortalRemote: jest.fn().mockResolvedValue(deal),
    findById: jest.fn().mockResolvedValue(deal),
    findByIdForUpdate: jest.fn().mockResolvedValue(deal),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const history = { record: jest.fn().mockResolvedValue(true) };
  const operations = { findById: jest.fn().mockResolvedValue(null) };
  const webhookEvents = {
    findById: jest.fn().mockResolvedValue(event),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const analytics = { increment: jest.fn().mockResolvedValue(undefined) };
  const feedback = { schedule: jest.fn().mockResolvedValue(undefined) };
  const context = {
    operationId: 'operation-1',
    acquireAggregateLease: jest.fn().mockResolvedValue('lease-1'),
    assertOwnership: jest.fn().mockResolvedValue(undefined),
    releaseAggregateLease: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DealRefreshService(
    dataSource as never,
    gateway as never,
    history,
    deals as never,
    operations as never,
    webhookEvents as never,
    analytics,
    feedback,
  );
  return {
    service,
    remote,
    deal,
    event,
    gateway,
    deals,
    history,
    operations,
    webhookEvents,
    analytics,
    feedback,
    context,
  };
}

describe('DealRefreshService', () => {
  it('quarantines an event without a remote ID before acquiring a lease', async () => {
    const { service, context } = setup();
    await expect(service.refresh('', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'DEAL_REMOTE_ID_MISSING',
    });
    expect(context.acquireAggregateLease).not.toHaveBeenCalled();
  });

  it('defers refresh when another worker owns the deal lease', async () => {
    const { service, context } = setup();
    context.acquireAggregateLease.mockResolvedValueOnce(null);
    await expect(service.refresh('42', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'DEAL_REFRESH_LEASE_BUSY',
      deferred: true,
    });
    expect(context.releaseAggregateLease).not.toHaveBeenCalled();
  });

  it('ignores unmanaged CRM deals and marks their webhook processed as ignored', async () => {
    const { service, deals, operations, webhookEvents, context } = setup();
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    deals.findByPortalRemote.mockResolvedValueOnce(null);

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'ignored',
      expect.anything(),
    );
    expect(context.releaseAggregateLease).toHaveBeenCalledWith('lease-1');
  });

  it('adopts a deal identified by its integration marker when no remote link exists', async () => {
    const { service, remote, deals, context } = setup();
    remote.marker = 'aasc-tiktok/deal/12345678-1234-1234-1234-123456789abc' as never;
    deals.findByPortalRemote.mockResolvedValueOnce(null);

    await expect(service.refresh('42', context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(deals.findById).toHaveBeenCalledWith('12345678-1234-1234-1234-123456789abc');
  });

  it('updates the local snapshot, history, and analytics when remote fields change', async () => {
    const { service, deals, history, analytics, context } = setup();

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(deals.update.mock.calls[0]?.[1]).toMatchObject({
      amount: '500.0000',
      currency: 'VND',
      stageId: 'C1:NEW',
      stageSemantics: 'open',
      probability: 25,
    });
    expect(history.record.mock.calls[0]?.[0]).toMatchObject({
      currentStageId: 'C1:NEW',
      amount: '500.0000',
      sourceComplete: true,
    });
    expect(analytics.increment).toHaveBeenCalledTimes(1);
  });

  it('uses win and loss semantics for probability and schedules won feedback', async () => {
    const { service, remote, deals, feedback, context } = setup();
    remote.fields.stageId = 'C1:WON';
    remote.fields.probability = -1;

    await service.refresh('42', context as never);
    expect(deals.update.mock.calls[0]?.[1]).toMatchObject({
      stageSemantics: 'won',
      probability: 100,
      everWonAt: expect.any(Date),
    });
    expect(feedback.schedule).toHaveBeenCalledWith('lead-1', 'deal_won', expect.anything());

    const lost = setup();
    lost.remote.fields.stageId = 'C1:LOST';
    lost.remote.fields.probability = -1;
    await lost.service.refresh('42', lost.context as never);
    expect(lost.deals.update.mock.calls[0]?.[1]).toMatchObject({
      stageSemantics: 'lost',
      probability: 0,
    });
    expect(lost.feedback.schedule).not.toHaveBeenCalled();
  });

  it('ignores a stale remote snapshot without overwriting a newer local one', async () => {
    const { service, deal, deals, operations, webhookEvents, context } = setup();
    deal.remoteModifiedAt = new Date('2026-10-02T00:00:00Z');
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(deals.update).not.toHaveBeenCalled();
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'processed',
      expect.anything(),
    );
  });

  it('re-reads a remote deal changed twice within the same timestamp', async () => {
    const { service, deal, gateway, context } = setup();
    deal.remoteModifiedAt = new Date('2026-10-01T00:00:00Z');
    deal.currentSnapshotHash = 'previous-hash';

    await service.refresh('42', context as never);

    expect(gateway.getDeal).toHaveBeenCalledTimes(2);
  });

  it('returns retry wait after an invalid CRM snapshot or missing ownership', async () => {
    const { service, remote, context } = setup();
    remote.fields.stageId = '';
    await expect(service.refresh('42', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'DEAL_REFRESH_FAILED',
    });
    expect(context.releaseAggregateLease).toHaveBeenCalledWith('lease-1');
  });

  it('tombstones a deleted deal without fetching it from Bitrix', async () => {
    const { service, operations, gateway, deals, history, analytics, webhookEvents, context } =
      setup();
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    webhookEvents.findById.mockResolvedValueOnce({
      id: 'event-1',
      eventType: 'deal.delete',
      eventKey: 'delete-1',
      occurredAt: new Date('2026-10-02T00:00:00Z'),
    });

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(gateway.getDeal).not.toHaveBeenCalled();
    expect(deals.update.mock.calls[0]?.[1]).toMatchObject({ stageDeletedAt: expect.any(Date) });
    expect(history.record.mock.calls[0]?.[0]).toMatchObject({
      providerRevisionKey: 'delete:delete-1',
      sourceComplete: true,
    });
    expect(analytics.increment).toHaveBeenCalledTimes(1);
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'processed',
      expect.anything(),
    );
  });

  it('treats repeated tombstones as successful without writing history again', async () => {
    const { service, deal, operations, webhookEvents, history, context } = setup();
    deal.stageDeletedAt = new Date('2026-10-02T00:00:00Z');
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    webhookEvents.findById.mockResolvedValueOnce({ id: 'event-1', eventType: 'deal.delete' });
    await service.refresh('42', context as never);

    expect(history.record).not.toHaveBeenCalled();
  });

  it('retries when a deal disappears before an update signal is reconciled', async () => {
    const { service, gateway, operations, context } = setup();
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    gateway.getDeal.mockRejectedValueOnce(new NotFoundException());

    await expect(service.refresh('42', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
    });
  });

  it('ignores a remote deal whose marker does not match a managed local deal', async () => {
    const { service, deals, remote, history, context } = setup();
    deals.findByPortalRemote.mockResolvedValueOnce(null);
    remote.marker = 'another-app/deal/unknown' as never;

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(history.record).not.toHaveBeenCalled();
  });

  it('returns success without a history write when the local deal disappeared before locking', async () => {
    const { service, deals, history, context } = setup();
    deals.findByIdForUpdate.mockResolvedValueOnce(null);

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(history.record).not.toHaveBeenCalled();
  });

  it('fills a missing CRM ID on an unchanged snapshot without recording a second history row', async () => {
    const { service, deal, deals, remote, history, context } = setup();
    await service.refresh('42', context as never);
    const hash = deals.update.mock.calls[0]?.[1]?.currentSnapshotHash as string;
    deals.update.mockClear();
    history.record.mockClear();
    deal.currentSnapshotHash = hash;
    deal.bitrixDealId = null;
    deal.remoteModifiedAt = null;
    remote.fields.updatedTime = '2026-10-01T00:00:00.000Z';

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(deals.update.mock.calls[0]?.[1]).toMatchObject({
      bitrixDealId: '42',
      remoteModifiedAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(history.record).not.toHaveBeenCalled();
  });

  it('uses alternate Bitrix field names and rejects malformed numeric snapshot values', async () => {
    const { service, remote, deals, context } = setup();
    remote.title = '';
    remote.fields = {
      STAGE_ID: 'C1:LOST',
      CATEGORY_ID: 1,
      DATE_MODIFY: 'invalid',
      OPPORTUNITY: 'not-money',
      CURRENCY_ID: ' USD ',
      ASSIGNED_BY_ID: 8,
      PROBABILITY: 999,
    } as never;

    await expect(service.refresh('42', context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(deals.update.mock.calls[0]?.[1]).toMatchObject({
      title: 'Local deal',
      stageSemantics: 'lost',
      amount: null,
      currency: 'USD',
      assignedTo: '8',
      probability: 0,
    });
  });

  it('marks an unknown delete signal ignored without writing a tombstone', async () => {
    const { service, operations, webhookEvents, deals, history, context } = setup();
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    webhookEvents.findById.mockResolvedValueOnce({ id: 'event-1', eventType: 'deal.delete' });
    deals.findByPortalRemote.mockResolvedValueOnce(null);

    await expect(service.refresh('42', context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(webhookEvents.updateStatus).toHaveBeenCalledWith(
      'event-1',
      'ignored',
      expect.anything(),
    );
    expect(history.record).not.toHaveBeenCalled();
  });

  it('does not increment analytics if a repeated delete revision was already recorded', async () => {
    const { service, operations, webhookEvents, history, analytics, context } = setup();
    operations.findById.mockResolvedValueOnce({ payload: { eventId: 'event-1' } });
    webhookEvents.findById.mockResolvedValueOnce({ id: 'event-1', eventType: 'deal.delete' });
    history.record.mockResolvedValueOnce(false);

    await service.refresh('42', context as never);

    expect(analytics.increment).not.toHaveBeenCalled();
  });
});
