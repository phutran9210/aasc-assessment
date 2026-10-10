import { AnalyticsRepository } from '../repositories/analytics.repository.js';

function builder() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };
}

describe('AnalyticsRepository', () => {
  it('runs every aggregate query, optional filter, empty campaign path and keyset page', async () => {
    const aggregate = builder();
    aggregate.getRawOne
      .mockResolvedValueOnce({ revision: undefined })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ count: '4' })
      .mockResolvedValueOnce({ oldest: new Date('2026-01-01T00:00:00Z') });
    aggregate.getRawMany
      .mockResolvedValueOnce([
        { campaignId: 'c1', leads: '2', convertedLeads: '1', wonLeads: '1', averageScore: null },
      ])
      .mockResolvedValueOnce([{ campaignId: 'c1', currency: 'USD', revenue: '12' }])
      .mockResolvedValueOnce([{ campaignId: 'c1', count: '3' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ campaignId: 'c1' }])
      .mockResolvedValueOnce([{ campaignId: 'c2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'lead-1' }])
      .mockResolvedValueOnce([]);
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ as_of: new Date('2026-01-01T00:00:00Z') }]),
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => aggregate) })),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((_isolation, work) => work(manager)),
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => aggregate) })),
    };
    const repository = new AnalyticsRepository(dataSource as never);
    const filter = {
      advertiserId: 'adv',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    };

    await expect(repository.revision()).resolves.toBe('0');
    await expect(repository.revision(manager as never)).resolves.toBe('0');
    await expect(repository.snapshot((_tx, asOf) => Promise.resolve(asOf))).resolves.toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(manager.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    await expect(repository.cohort(filter, manager as never)).resolves.toMatchObject({
      campaignId: null,
      leads: 0,
      averageScore: null,
    });
    await expect(repository.cohortsByCampaign(filter, [], manager as never)).resolves.toEqual([]);
    await expect(
      repository.cohortsByCampaign(filter, ['c1'], manager as never),
    ).resolves.toMatchObject([{ campaignId: 'c1', leads: 2, wonLeads: 1 }]);
    await expect(repository.revenueByCampaign(filter, [], manager as never)).resolves.toEqual([]);
    await expect(repository.revenueByCampaign(filter, ['c1'], manager as never)).resolves.toEqual([
      { campaignId: 'c1', currency: 'USD', revenue: '12' },
    ]);
    await expect(repository.unattributedLeads(filter, manager as never)).resolves.toBe(4);
    await expect(repository.submissions(filter, manager as never)).resolves.toEqual(
      new Map([['c1', 3]]),
    );
    await repository.submissions({ ...filter, campaignId: 'c1' }, manager as never);
    await expect(
      repository.campaignIds(
        filter,
        { fromDate: '2026-01-01', toDate: '2026-02-01' },
        manager as never,
      ),
    ).resolves.toEqual(['c1', 'c2']);
    await repository.campaignIds(
      filter,
      { fromDate: '2026-01-01', toDate: '2026-02-01', currency: 'USD' },
      manager as never,
    );
    await expect(repository.oldestPendingOperation(manager as never)).resolves.toBe(
      '2026-01-01T00:00:00.000Z',
    );
    await expect(repository.scoreCandidates(null, 10)).resolves.toEqual(['lead-1']);
    await repository.scoreCandidates('lead-0', 10);
    expect(aggregate.andWhere).toHaveBeenCalled();
  });
});
