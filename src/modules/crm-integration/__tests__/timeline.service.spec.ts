import { TimelineService } from '../services/timeline.service.js';

describe('TimelineService', () => {
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
});
