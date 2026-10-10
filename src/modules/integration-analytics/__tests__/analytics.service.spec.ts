import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from '../services/analytics.service.js';
import type { AnalyticsRepository } from '../repositories/analytics.repository.js';
import type { CampaignCostService } from '../services/campaign-cost.service.js';
import type { AnalyticsScope } from '../types/analytics.types.js';

const scope: AnalyticsScope = {
  advertiserId: 'adv',
  portalKey: 'portal',
  tiktokMode: 'mock',
  bitrixMode: 'mock',
  reportTimezone: 'Asia/Ho_Chi_Minh',
};
const cohort = {
  campaignId: 'c1',
  leads: 4,
  convertedLeads: 2,
  wonLeads: 1,
  everWonLeads: 1,
  openDeals: 1,
  lostDeals: 0,
  deletedDeals: 0,
  missingAmountDeals: 0,
  averageScore: '8.5',
};

function makeService(overrides: Record<string, unknown> = {}) {
  const repository = {
    revision: jest.fn(() => 'r1'),
    snapshot: jest.fn((work: (manager: object, asOf: string) => unknown) =>
      work({}, '2026-02-01T00:00:00.000Z'),
    ),
    cohort: jest.fn(() => cohort),
    submissions: jest.fn(() => new Map([['c1', 5]])),
    oldestPendingOperation: jest.fn(() => '2026-01-01T00:00:00.000Z'),
    campaignIds: jest.fn(() => ['c1', 'c2']),
    cohortsByCampaign: jest.fn(() => [cohort]),
    revenueByCampaign: jest.fn(() => [{ campaignId: 'c1', currency: 'USD', revenue: '30.00' }]),
    unattributedLeads: jest.fn(() => 2),
    ...overrides,
  } as unknown as AnalyticsRepository;
  const costs = {
    summarize: jest.fn(() => [
      {
        campaignId: 'c1',
        currency: 'USD',
        knownSpend: '10.00',
        impressions: '100',
        clicks: '10',
        coveredDays: 31,
        requestedDays: 31,
        spendComplete: true,
        sources: ['mock'],
        fetchedAt: '2026-01-30T00:00:00.000Z',
      },
    ]),
  } as unknown as CampaignCostService;
  const cache = {
    getOrCompute: jest.fn((_scope, _revision, _query, compute) => compute()),
  } as never;
  return {
    service: new AnalyticsService(
      repository,
      costs,
      cache,
      scope,
      () => '2026-02-01T00:00:00.000Z',
    ),
    repository,
    costs,
  };
}

describe('AnalyticsService', () => {
  it('returns zeroed conversion metrics for an empty cohort and reports freshness metadata', async () => {
    const { service } = makeService({
      cohort: jest.fn(() => ({
        ...cohort,
        leads: 0,
        convertedLeads: 0,
        wonLeads: 0,
        everWonLeads: 0,
        openDeals: 0,
        averageScore: null,
      })),
      submissions: jest.fn(() => new Map()),
      oldestPendingOperation: jest.fn(() => null),
    });
    const result = await service.conversionRates({
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(result).toMatchObject({
      leads: 0,
      submissions: 0,
      campaignId: null,
      stale: false,
      leadToWonRate: null,
      oldestPendingAt: null,
    });
  });

  it('calculates campaign financials, paginates and includes an empty campaign cohort', async () => {
    const { service } = makeService();
    const result = await service.campaignPerformance({
      from: '2026-01-01',
      to: '2026-02-01',
      page: 1,
      limit: 10,
      currency: 'usd',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      campaignId: 'c1',
      leads: 4,
      qualityScore: '8.5',
      financials: [{ currency: 'USD', knownSpend: '10', revenue: '30' }],
    });
    expect(result.items[1]).toMatchObject({
      campaignId: 'c2',
      leads: 0,
      financials: [{ currency: null, spendComplete: false }],
    });
    expect(result).toMatchObject({ total: 2, unattributedLeads: 2, stale: true });
  });

  it('rejects invalid timezone, currency and period inputs', async () => {
    const { service } = makeService();
    await expect(
      service.campaignPerformance({ page: 1, limit: 10, timezone: 'UTC' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.campaignPerformance({ page: 1, limit: 10, currency: 'US' }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.conversionRates({ from: 'not-a-date' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('handles a selected campaign without cost or revenue data in the requested currency', async () => {
    const { service, repository, costs } = makeService({
      cohortsByCampaign: jest.fn(() => []),
      revenueByCampaign: jest.fn(() => []),
    });
    costs.summarize = jest.fn(() => Promise.resolve([]));

    const result = await service.campaignPerformance({
      from: '2026-01-01',
      to: '2026-02-01',
      page: 1,
      limit: 10,
      campaignId: 'selected',
    });

    expect(result).toMatchObject({
      total: 1,
      unattributedLeads: 0,
      items: [
        {
          campaignId: 'selected',
          financials: [{ currency: null, knownSpend: null, revenue: '0', coveredDays: 0 }],
        },
      ],
    });
    expect(repository.campaignIds).not.toHaveBeenCalled();
    expect(repository.unattributedLeads).not.toHaveBeenCalled();
  });

  it('keeps currencies separate and reports incomplete cost and revenue data', async () => {
    const { service, costs } = makeService({
      cohortsByCampaign: jest.fn(() => [{ ...cohort, missingAmountDeals: 1, averageScore: null }]),
      revenueByCampaign: jest.fn(() => [{ campaignId: 'c1', currency: 'EUR', revenue: '12.50' }]),
    });
    costs.summarize = jest.fn(() =>
      Promise.resolve([
        {
          campaignId: 'c1',
          currency: 'USD',
          knownSpend: null,
          impressions: null,
          clicks: null,
          coveredDays: 0,
          requestedDays: 31,
          spendComplete: false,
          sources: [],
          fetchedAt: null,
        },
      ]),
    );

    const result = await service.campaignPerformance({
      from: '2026-01-01',
      to: '2026-02-01',
      page: 1,
      limit: 10,
    });

    expect(result.items[0]).toMatchObject({
      qualityScore: null,
      revenueComplete: false,
      financials: [
        { currency: 'EUR', spendComplete: false, revenue: '12.5', costFetchedAt: null },
        { currency: 'USD', spendComplete: false, revenue: '0', costFetchedAt: null },
      ],
    });
  });
});
