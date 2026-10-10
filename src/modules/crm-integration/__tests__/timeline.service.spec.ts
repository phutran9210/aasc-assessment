import { TimelineService } from '../services/timeline.service.js';

describe('TimelineService', () => {
  function setup() {
    const timeline = {
      id: 'timeline-1',
      leadId: 'lead-1',
      entityType: 'deal',
      remoteEntityId: 'deal-42',
      marker: 'aasc-tiktok/timeline/lead-1/deal-42',
      comment: 'Converted',
      status: 'pending',
      attempt: 0,
      nextAttemptAt: null,
    };
    const manager = {};
    const dataSource = {
      manager,
      transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
    };
    const gateway = { addTimeline: jest.fn().mockResolvedValue({ id: 'remote-timeline-1' }) };
    const reconciliation = { find: jest.fn().mockResolvedValue({ status: 'not_found' }) };
    const timelines = {
      findById: jest.fn().mockResolvedValue(timeline),
      findByIdForUpdate: jest.fn().mockResolvedValue(timeline),
      findByMarker: jest.fn().mockResolvedValue(null),
      save: jest.fn((value: typeof timeline) => Promise.resolve(value)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const operations = {
      ensure: jest.fn().mockResolvedValue({ id: 'operation-1', status: 'pending' }),
    };
    const outbox = {
      hasUnpublished: jest.fn().mockResolvedValue(false),
      append: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TimelineService(
      dataSource as never,
      gateway as never,
      reconciliation as never,
      operations as never,
      outbox,
      timelines as never,
    );
    const context = {
      assertOwnership: jest.fn().mockResolvedValue(undefined),
      revisions: { mapping: 1 },
    };
    return {
      service,
      timeline,
      manager,
      gateway,
      reconciliation,
      timelines,
      operations,
      outbox,
      context,
    };
  }

  it('does not call Bitrix when the operation owner is stale', async () => {
    const gateway = { addTimeline: jest.fn() };
    const service = new TimelineService(
      {} as never,
      gateway as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = {
      assertOwnership: jest.fn().mockRejectedValue(new Error('LEASE_LOST')),
    };

    await expect(service.execute('timeline-1', context as never)).rejects.toThrow('LEASE_LOST');
    expect(gateway.addTimeline).not.toHaveBeenCalled();
  });

  it('reuses the timeline identified by its marker when appending again', async () => {
    const existing = { id: 'timeline-1', leadId: 'lead-1', marker: 'stable-marker' };
    const manager = {} as never;
    const timelines = {
      findByMarker: jest.fn().mockResolvedValue(existing),
      save: jest.fn(),
    };
    const operations = {
      ensure: jest.fn().mockResolvedValue({ id: 'operation-1', status: 'succeeded' }),
    };
    const outbox = { hasUnpublished: jest.fn(), append: jest.fn() };
    const service = new TimelineService(
      {} as never,
      {} as never,
      {} as never,
      operations as never,
      outbox,
      timelines as never,
    );

    await expect(
      service.append(
        {
          leadId: 'lead-1',
          entityType: 'deal',
          entityId: 'remote-1',
          marker: 'stable-marker',
          comment: 'Converted',
        },
        { revisions: {} } as never,
        manager,
      ),
    ).resolves.toBe('timeline-1');
    expect(timelines.save).not.toHaveBeenCalled();
    expect(operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ operationKey: 'crm-timeline/timeline-1/0' }),
      manager,
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('persists a new timeline and queues exactly one unpublished operation', async () => {
    const { service, operations, outbox, timelines, context } = setup();

    const id = await service.append(
      {
        leadId: 'lead-1',
        entityType: 'deal',
        entityId: 'deal-42',
        marker: '',
        comment: 'Converted',
      },
      context as never,
    );

    expect(id).toEqual(expect.any(String));
    expect(timelines.save.mock.calls[0]?.[0]).toMatchObject({
      marker: 'aasc-tiktok/timeline/lead-1/deal-42',
      comment: 'Converted',
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      kind: 'crm_timeline',
      aggregateId: 'lead-1',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('does not publish a duplicate operation when the outbox already contains it', async () => {
    const { service, timelines, outbox, context } = setup();
    timelines.findByMarker.mockResolvedValueOnce({
      id: 'timeline-1',
      leadId: 'lead-1',
      marker: 'stable',
    });
    outbox.hasUnpublished.mockResolvedValueOnce(true);

    await service.append(
      {
        leadId: 'lead-1',
        entityType: 'deal',
        entityId: 'deal-42',
        marker: 'stable',
        comment: 'Converted',
      },
      context as never,
    );

    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('quarantines a missing timeline without calling the CRM', async () => {
    const { service, timelines, gateway, context } = setup();
    timelines.findById.mockResolvedValueOnce(null);

    await expect(service.execute('missing', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'TIMELINE_NOT_FOUND',
    });
    expect(gateway.addTimeline).not.toHaveBeenCalled();
  });

  it('requires reconciliation when the remote marker is ambiguous', async () => {
    const { service, reconciliation, timelines, gateway, context } = setup();
    reconciliation.find.mockResolvedValueOnce({ status: 'ambiguous' });

    await expect(service.execute('timeline-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'TIMELINE_MARKER_AMBIGUOUS',
    });
    expect(timelines.update.mock.calls[0]?.[1]).toMatchObject({ status: 'reconcile_required' });
    expect(gateway.addTimeline).not.toHaveBeenCalled();
  });

  it('adopts an existing remote comment without posting it twice', async () => {
    const { service, reconciliation, timelines, gateway, context } = setup();
    reconciliation.find.mockResolvedValueOnce({ status: 'found', value: { id: 'remote-7' } });

    await expect(service.execute('timeline-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(timelines.update.mock.calls[0]?.[1]).toMatchObject({
      status: 'posted',
      remoteTimelineId: 'remote-7',
    });
    expect(gateway.addTimeline).not.toHaveBeenCalled();
  });

  it('posts a comment only after checking that its marker is absent', async () => {
    const { service, gateway, timelines, context } = setup();

    await expect(service.execute('timeline-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(gateway.addTimeline).toHaveBeenCalledWith({
      entityType: 'deal',
      entityId: 'deal-42',
      marker: 'aasc-tiktok/timeline/lead-1/deal-42',
      comment: 'Converted',
    });
    expect(timelines.update.mock.calls[0]?.[1]).toMatchObject({
      status: 'posted',
      remoteTimelineId: 'remote-timeline-1',
    });
  });

  it('schedules another reconciliation attempt after an ambiguous CRM failure', async () => {
    const { service, gateway, timelines, operations, outbox, context } = setup();
    gateway.addTimeline.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.execute('timeline-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'TIMELINE_MUTATION_AMBIGUOUS',
    });
    expect(timelines.save.mock.calls[0]?.[0]).toMatchObject({ attempt: 1, status: 'pending' });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'crm-timeline/timeline-1/1',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after the reconciliation budget is exhausted', async () => {
    const { service, timeline, gateway, timelines, outbox, context } = setup();
    timeline.attempt = 100;
    gateway.addTimeline.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.execute('timeline-1', context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'TIMELINE_RECONCILIATION_EXHAUSTED',
    });
    expect(timelines.save.mock.calls[0]?.[0]).toMatchObject({
      status: 'reconcile_required',
      nextAttemptAt: null,
    });
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
