import { DealPollService } from '../services/deal-poll.service.js';

function setup(checkpoint: Record<string, unknown> = {}) {
  const saved = {
    incrementalWatermark: null,
    fullScanAt: null,
    activeMode: null,
    pageOffset: 0,
    ...checkpoint,
  };
  const queryRunner = {
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue([{ locked: true }]),
    release: jest.fn(),
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    transaction: jest.fn((work) => work({})),
  };
  const gateway = { listDealsPage: jest.fn().mockResolvedValue([]) };
  const operations = { ensure: jest.fn().mockResolvedValue({ id: 'op-1', status: 'pending' }) };
  const outbox = {
    hasUnpublished: jest.fn().mockResolvedValue(false),
    append: jest.fn().mockResolvedValue(undefined),
  };
  const pollData = {
    checkpoint: jest.fn().mockResolvedValue(saved),
    saveCheckpoint: jest.fn((value) => value),
    listManagedPage: jest.fn().mockResolvedValue([]),
    isManaged: jest.fn().mockResolvedValue(false),
    hasLocalId: jest.fn().mockResolvedValue(false),
  };
  const service = new DealPollService(
    dataSource as never,
    gateway as never,
    operations as never,
    outbox,
    pollData as never,
  );
  return { service, queryRunner, dataSource, gateway, operations, outbox, pollData, saved };
}

describe('DealPollService', () => {
  it('skips a poll when another process holds the advisory lock and always releases the runner', async () => {
    const state = setup();
    state.queryRunner.query.mockResolvedValueOnce([{ locked: false }]);
    await expect(state.service.run('incremental')).resolves.toMatchObject({
      scanned: 0,
      skippedLocked: true,
      complete: true,
    });
    expect(state.queryRunner.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      expect.any(Array),
    );
    expect(state.queryRunner.release).toHaveBeenCalled();
  });

  it('queues managed incremental deals, ignores unrelated records, and advances the cursor', async () => {
    const state = setup({ incrementalWatermark: new Date('2026-01-01T00:00:00Z') });
    state.gateway.listDealsPage.mockResolvedValueOnce([
      { id: 'managed', title: 'Managed', marker: null, fields: {} },
      {
        id: 'local',
        title: 'Local marker',
        marker: 'aasc-tiktok/deal/00000000-0000-4000-8000-000000000001',
        fields: {},
      },
      { id: 'other', title: 'Other', marker: null, fields: {} },
    ]);
    state.pollData.isManaged.mockResolvedValueOnce(true).mockResolvedValue(false);
    state.pollData.hasLocalId.mockResolvedValueOnce(true);
    state.outbox.hasUnpublished.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(state.service.run('incremental')).resolves.toMatchObject({
      scanned: 3,
      queued: 2,
      ignored: 1,
      skippedLocked: false,
    });
    expect(state.gateway.listDealsPage).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 50, modifiedSince: expect.any(Date) }),
    );
    expect(state.operations.ensure).toHaveBeenCalledTimes(2);
    expect(state.outbox.append).toHaveBeenCalledTimes(1);
    expect(state.pollData.saveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        activeMode: null,
        pageOffset: 0,
        incrementalWatermark: expect.any(Date),
      }),
    );
  });

  it('lists only linked managed deals during full scans and persists the full-scan time', async () => {
    const state = setup();
    state.pollData.listManagedPage.mockResolvedValueOnce([
      { bitrixDealId: 'remote-1', title: 'One' },
      { bitrixDealId: null, title: 'No remote id' },
    ]);
    state.outbox.hasUnpublished.mockResolvedValue(true);
    await expect(state.service.run('full')).resolves.toMatchObject({
      mode: 'full',
      scanned: 1,
      queued: 1,
      ignored: 0,
    });
    expect(state.pollData.listManagedPage).toHaveBeenCalledWith(expect.any(String), 0, 50);
    expect(state.gateway.listDealsPage).not.toHaveBeenCalled();
    expect(state.pollData.saveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ fullScanAt: expect.any(Date), activeMode: null }),
    );
  });

  it('reports whether the last full scan is missing, stale, or recent', async () => {
    expect(await setup().service.isFullScanDue()).toBe(true);
    expect(
      await setup({
        fullScanAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      }).service.isFullScanDue(),
    ).toBe(true);
    expect(await setup({ fullScanAt: new Date() }).service.isFullScanDue()).toBe(false);
  });
});
