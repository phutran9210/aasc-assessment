import { AnalyticsRevisionEntity } from '@modules/integration-analytics/entities/analytics-revision.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { CampaignCostRepository } from '@modules/integration-analytics/repositories/campaign-cost.repository.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import type {
  CampaignCostRow,
  CampaignCostSource,
} from '@modules/integration-analytics/types/analytics.types.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const advertiserId = 'advertiser-cost';

describe('campaign daily cost persistence', () => {
  let infrastructure: TestInfrastructure;
  let service: CampaignCostService;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    service = new CampaignCostService(
      new CampaignCostRepository(),
      new AnalyticsRevisionRepository(),
    );
  });

  afterAll(async () => {
    await infrastructure.close();
  });

  beforeEach(async () => {
    await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).clear();
  });

  function cost(patch: Partial<CampaignCostRow> = {}): CampaignCostRow {
    return {
      advertiserId,
      campaignId: 'cmp-1',
      reportDate: '2026-10-01',
      reportingTimezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      spend: '1000000',
      ...patch,
    };
  }

  function upsert(rows: CampaignCostRow[], source: CampaignCostSource = 'import') {
    return infrastructure.database.dataSource.transaction((tx) => service.upsert(rows, source, tx));
  }

  function summarize(campaignIds: string[], fromDate: string, toDate: string, currency?: string) {
    return service.summarize(
      { advertiserId, campaignIds, fromDate, toDate, currency },
      infrastructure.database.dataSource.manager,
    );
  }

  async function revision(): Promise<string> {
    const [row] = await infrastructure.database.dataSource
      .getRepository(AnalyticsRevisionEntity)
      .find();
    return row.revision;
  }

  it('upserts by natural key and bumps the analytics revision only for material changes', async () => {
    const before = BigInt(await revision());
    const firstFetch = new Date('2026-10-02T01:00:00.000Z');
    const secondFetch = new Date('2026-10-03T01:00:00.000Z');

    expect(await upsert([cost({ fetchedAt: firstFetch, clicks: '12' })], 'mock')).toEqual({
      inserted: 1,
      updated: 0,
      unchanged: 0,
    });
    expect(BigInt(await revision())).toBe(before + 1n);

    expect(await upsert([cost({ fetchedAt: secondFetch, clicks: '12' })], 'import')).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(BigInt(await revision())).toBe(before + 1n);

    expect(await upsert([cost({ spend: '1250000.5', clicks: '12' })], 'api')).toEqual({
      inserted: 0,
      updated: 1,
      unchanged: 0,
    });
    expect(BigInt(await revision())).toBe(before + 2n);

    const rows = await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reportDate: '2026-10-01',
      spend: '1250000.5000',
      clicks: '12',
      impressions: null,
      source: 'api',
    });
    expect(rows[0].fetchedAt.getTime()).toBeGreaterThan(secondFetch.getTime());
  });

  it('refreshes fetchedAt and source of an unchanged row', async () => {
    await upsert([cost({ fetchedAt: new Date('2026-10-02T01:00:00.000Z') })], 'mock');
    await upsert([cost({ fetchedAt: new Date('2026-10-03T01:00:00.000Z') })], 'import');

    const [row] = await infrastructure.database.dataSource
      .getRepository(CampaignDailyEntity)
      .find();
    expect(row.source).toBe('import');
    expect(row.fetchedAt.toISOString()).toBe('2026-10-03T01:00:00.000Z');
  });

  it('rolls back the revision bump together with the rows', async () => {
    const before = await revision();

    await expect(
      infrastructure.database.dataSource.transaction(async (tx) => {
        await service.upsert([cost()], 'import', tx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    expect(await revision()).toBe(before);
    expect(
      await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).count(),
    ).toBe(0);
  });

  it('treats a zero spend day as data and a missing day as incomplete', async () => {
    await upsert([
      cost({ reportDate: '2026-10-01', spend: '400000' }),
      cost({ reportDate: '2026-10-02', spend: '0' }),
      cost({ reportDate: '2026-10-03', spend: '600000' }),
      cost({ campaignId: 'cmp-2', reportDate: '2026-10-01', spend: '50' }),
      cost({ campaignId: 'cmp-2', reportDate: '2026-10-03', spend: '70' }),
    ]);

    const groups = await summarize(['cmp-1', 'cmp-2', 'cmp-3'], '2026-10-01', '2026-10-04');

    expect(groups).toEqual([
      expect.objectContaining({
        campaignId: 'cmp-1',
        currency: 'VND',
        knownSpend: '1000000',
        coveredDays: 3,
        requestedDays: 3,
        spendComplete: true,
      }),
      expect.objectContaining({
        campaignId: 'cmp-2',
        currency: 'VND',
        knownSpend: '120',
        coveredDays: 2,
        spendComplete: false,
      }),
      expect.objectContaining({
        campaignId: 'cmp-3',
        currency: null,
        knownSpend: null,
        coveredDays: 0,
        spendComplete: false,
      }),
    ]);
  });

  it('excludes the exclusive end day and other advertisers', async () => {
    await upsert([
      cost({ reportDate: '2026-10-01', spend: '10' }),
      cost({ reportDate: '2026-10-02', spend: '20' }),
      cost({ advertiserId: 'someone-else', reportDate: '2026-10-01', spend: '999' }),
    ]);

    const [group] = await summarize(['cmp-1'], '2026-10-01', '2026-10-02');

    expect(group).toMatchObject({ knownSpend: '10', coveredDays: 1, spendComplete: true });
  });

  it('groups foreign currencies instead of adding them together', async () => {
    await upsert([
      cost({ reportDate: '2026-10-01', spend: '1000000' }),
      cost({ reportDate: '2026-10-01', currency: 'USD', spend: '40.25' }),
      cost({ reportDate: '2026-10-02', currency: 'USD', spend: '9.75' }),
    ]);

    const groups = await summarize(['cmp-1'], '2026-10-01', '2026-10-03');

    expect(groups).toEqual([
      expect.objectContaining({ currency: 'USD', knownSpend: '50', spendComplete: true }),
      expect.objectContaining({ currency: 'VND', knownSpend: '1000000', spendComplete: false }),
    ]);
    expect(await summarize(['cmp-1'], '2026-10-01', '2026-10-03', 'USD')).toEqual([
      expect.objectContaining({ currency: 'USD', knownSpend: '50', spendComplete: true }),
    ]);
  });

  it('round-trips the largest numeric(20,4) amount and sums beyond double precision', async () => {
    await upsert([
      cost({
        reportDate: '2026-10-01',
        spend: '9999999999999999.9999',
        impressions: '9007199254740993',
      }),
      cost({ reportDate: '2026-10-02', spend: '9007199254740993.0001', impressions: '2' }),
    ]);

    const stored = await infrastructure.database.dataSource
      .getRepository(CampaignDailyEntity)
      .findOneByOrFail({ reportDate: '2026-10-01' });
    const [group] = await summarize(['cmp-1'], '2026-10-01', '2026-10-03');

    expect(stored.spend).toBe('9999999999999999.9999');
    expect(group).toMatchObject({
      knownSpend: '19007199254740993',
      impressions: '9007199254740995',
    });
  });

  it('keeps one row when two transactions upsert the same natural key concurrently', async () => {
    const results = await Promise.all([
      upsert([cost({ spend: '1' })]),
      upsert([cost({ spend: '2' })]),
    ]);

    expect(results.reduce((total, summary) => total + summary.inserted, 0)).toBeGreaterThan(0);
    expect(
      await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).count(),
    ).toBe(1);
  });
});
