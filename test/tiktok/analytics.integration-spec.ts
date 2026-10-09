import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { AnalyticsRepository } from '@modules/integration-analytics/repositories/analytics.repository.js';
import { CampaignCostRepository } from '@modules/integration-analytics/repositories/campaign-cost.repository.js';
import {
  AnalyticsCache,
  RedisAnalyticsCacheStore,
} from '@modules/integration-analytics/services/analytics-cache.service.js';
import { AnalyticsService } from '@modules/integration-analytics/services/analytics.service.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import type { AnalyticsScope } from '@modules/integration-analytics/types/analytics.types.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const scope: AnalyticsScope = {
  advertiserId: 'advertiser-analytics',
  portalKey: 'analytics-portal',
  tiktokMode: 'mock',
  bitrixMode: 'mock',
  reportTimezone: 'Asia/Ho_Chi_Minh',
};
const NOW = '2026-10-09T05:30:00.000Z';
const october = { from: '2026-10-01', to: '2026-10-04', timezone: 'Asia/Ho_Chi_Minh' };
const inPeriod = (day: number, hour = 3) => new Date(Date.UTC(2026, 9, day, hour));

describe('cohort analytics', () => {
  let infrastructure: TestInfrastructure;
  let analytics: AnalyticsService;
  let repository: AnalyticsRepository;
  let costs: CampaignCostService;
  let revisions: AnalyticsRevisionRepository;
  let fixtures: ReturnType<typeof analyticsFixtures>;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    const dataSource = infrastructure.database.dataSource;
    repository = new AnalyticsRepository(dataSource);
    revisions = new AnalyticsRevisionRepository();
    costs = new CampaignCostService(new CampaignCostRepository(), revisions);
    analytics = new AnalyticsService(
      repository,
      costs,
      new AnalyticsCache(new RedisAnalyticsCacheStore(infrastructure.redis)),
      scope,
      () => NOW,
    );
    fixtures = analyticsFixtures(dataSource, scope.advertiserId);
  });

  afterAll(async () => {
    await infrastructure.close();
  });

  beforeEach(async () => {
    const dataSource = infrastructure.database.dataSource;
    await dataSource.query(
      `TRUNCATE ${[
        'integration_deal_history',
        'integration_deal',
        'integration_submission',
        'integration_lead',
        'integration_campaign_daily',
        'integration_outbox',
        'integration_operation',
      ]
        .map((table) => `"${infrastructure.database.schema}"."${table}"`)
        .join(', ')} CASCADE`,
    );
    await bump();
  });

  function bump(): Promise<void> {
    return infrastructure.database.dataSource.transaction((tx) => revisions.increment(tx));
  }

  function saveCosts(
    rows: Array<{ campaignId?: string; reportDate: string; spend: string; currency?: string }>,
  ) {
    return infrastructure.database.dataSource.transaction((tx) =>
      costs.upsert(
        rows.map((row) => ({
          advertiserId: scope.advertiserId,
          campaignId: row.campaignId ?? 'cmp-1',
          reportDate: row.reportDate,
          reportingTimezone: scope.reportTimezone,
          currency: row.currency ?? 'VND',
          spend: row.spend,
        })),
        'import',
        tx,
      ),
    );
  }

  /** Ten unique leads on cmp-1: four converted, two of them currently won for 1.5m each. */
  async function acceptanceCohort(): Promise<string[]> {
    const leadIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      leadIds.push(await fixtures.saveLead({ firstTouchAt: inPeriod(1 + (index % 3)), score: 60 }));
    }
    for (const [index, leadId] of leadIds.slice(0, 4).entries()) {
      await fixtures.saveDeal({
        leadId,
        stageSemantics: index < 2 ? 'won' : 'open',
        amount: '1500000',
      });
    }
    return leadIds;
  }

  it('reports 40/20/50 for ten leads, four converted and two won', async () => {
    await acceptanceCohort();
    await bump();

    const rates = await analytics.conversionRates(october);

    expect(rates).toMatchObject({
      leads: 10,
      convertedLeads: 4,
      wonLeads: 2,
      openDeals: 2,
      leadToDealRate: '40',
      leadToWonRate: '20',
      dealToWonRate: '50',
      attributionModel: 'first_touch',
      revenueBasis: 'cohort_to_date',
      providerMode: { tiktok: 'mock', bitrix: 'mock' },
      period: {
        from: '2026-09-30T17:00:00.000Z',
        to: '2026-10-03T17:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      generatedAt: NOW,
      stale: false,
    });
    expect(Number.isNaN(Date.parse(rates.dataAsOf))).toBe(false);
  });

  it('does not multiply counts or revenue by repeated submissions and deal history', async () => {
    const leadIds = await acceptanceCohort();
    for (const leadId of leadIds) {
      await fixtures.saveSubmission({ leadId, occurredAt: inPeriod(1) });
      await fixtures.saveSubmission({ leadId, occurredAt: inPeriod(2) });
      await fixtures.saveSubmission({ leadId, occurredAt: inPeriod(2), event: 'click' });
    }
    const deals = await infrastructure.database.dataSource.getRepository(DealEntity).find();
    for (const deal of deals) {
      await fixtures.saveDealHistory(deal.id, 'open', '1');
      await fixtures.saveDealHistory(deal.id, 'won', '1500000');
      await fixtures.saveDealHistory(deal.id, 'won', '1500000');
    }
    await saveCosts([
      { reportDate: '2026-10-01', spend: '400000' },
      { reportDate: '2026-10-02', spend: '0' },
      { reportDate: '2026-10-03', spend: '600000' },
    ]);

    const rates = await analytics.conversionRates(october);
    const performance = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });

    expect(rates).toMatchObject({ leads: 10, submissions: 20, convertedLeads: 4, wonLeads: 2 });
    expect(performance.total).toBe(1);
    expect(performance.items[0]).toMatchObject({
      campaignId: 'cmp-1',
      leads: 10,
      submissions: 20,
      convertedLeads: 4,
      wonLeads: 2,
      qualityScore: '60',
      spendComplete: true,
      revenueComplete: true,
      financials: [
        {
          currency: 'VND',
          knownSpend: '1000000',
          revenue: '3000000',
          cpl: '100000',
          roi: '200',
          roas: '3',
        },
      ],
    });
    expect(performance).toMatchObject({ revenueBasis: 'cohort_to_date', unattributedLeads: 0 });
  });

  it('moves a lead to the earlier imported first-touch campaign and invalidates the cache', async () => {
    const leadId = await fixtures.saveLead({ campaignId: 'cmp-late', firstTouchAt: inPeriod(2) });
    await bump();
    const before = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });
    expect(before.items.map((item) => [item.campaignId, item.leads])).toEqual([['cmp-late', 1]]);

    await infrastructure.database.dataSource.transaction(async (tx) => {
      await tx
        .getRepository(LeadEntity)
        .update(leadId, { firstTouchCampaignId: 'cmp-early', firstTouchAt: inPeriod(1) });
      await revisions.increment(tx);
    });

    const after = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });
    expect(after.items.map((item) => [item.campaignId, item.leads])).toEqual([['cmp-early', 1]]);
    expect(BigInt(after.revision)).toBe(BigInt(before.revision) + 1n);
  });

  it('keeps serving the cached response until the revision changes', async () => {
    await fixtures.saveLead({ firstTouchAt: inPeriod(1) });
    await bump();
    expect((await analytics.conversionRates(october)).leads).toBe(1);

    await fixtures.saveLead({ firstTouchAt: inPeriod(1) });
    expect((await analytics.conversionRates(october)).leads).toBe(1);

    await bump();
    expect((await analytics.conversionRates(october)).leads).toBe(2);
  });

  it('computes concurrent identical requests once and returns one consistent snapshot', async () => {
    await acceptanceCohort();
    await bump();
    const snapshot = jest.spyOn(repository, 'snapshot');

    const results = await Promise.all(
      Array.from({ length: 6 }, () => analytics.conversionRates(october)),
    );

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((result) => result.dataAsOf)).size).toBe(1);
    snapshot.mockRestore();
  });

  it('counts by first-touch time rather than createdAt', async () => {
    await fixtures.saveLead({
      firstTouchAt: inPeriod(2),
      createdAt: new Date('2026-11-20T00:00:00Z'),
    });
    await fixtures.saveLead({
      firstTouchAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: inPeriod(2),
    });
    await fixtures.saveLead({ firstTouchAt: new Date('2026-10-03T17:00:00.000Z') });
    await fixtures.saveLead({ firstTouchAt: new Date('2026-09-30T17:00:00.000Z') });
    await bump();

    expect((await analytics.conversionRates(october)).leads).toBe(2);
  });

  it('only counts a won deal whose conversion saga completed', async () => {
    const [first, second, third] = await Promise.all(
      [1, 2, 3].map(() => fixtures.saveLead({ firstTouchAt: inPeriod(1) })),
    );
    await fixtures.saveDeal({ leadId: first, stageSemantics: 'won' });
    await fixtures.saveDeal({
      leadId: second,
      stageSemantics: 'won',
      conversionStatus: 'deal_created',
    });
    await fixtures.saveDeal({ leadId: third, stageSemantics: 'lost', everWonAt: inPeriod(2) });
    await bump();

    const rates = await analytics.conversionRates(october);

    expect(rates).toMatchObject({
      leads: 3,
      convertedLeads: 2,
      wonLeads: 1,
      lostDeals: 1,
      everWonLeads: 1,
      dealToWonRate: '50',
      leadToWonRate: '33.3333',
    });
  });

  it('does not turn a deleted deal into a lost or won one', async () => {
    const [first, second] = await Promise.all(
      [1, 2].map(() => fixtures.saveLead({ firstTouchAt: inPeriod(1) })),
    );
    await fixtures.saveDeal({ leadId: first, stageSemantics: 'won', deletedAt: inPeriod(3) });
    await fixtures.saveDeal({ leadId: second, stageSemantics: 'open', deletedAt: inPeriod(3) });
    await saveCosts([
      { reportDate: '2026-10-01', spend: '10' },
      { reportDate: '2026-10-02', spend: '10' },
      { reportDate: '2026-10-03', spend: '10' },
    ]);

    const rates = await analytics.conversionRates(october);
    const performance = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });

    expect(rates).toMatchObject({
      convertedLeads: 2,
      wonLeads: 0,
      lostDeals: 0,
      openDeals: 0,
      deletedDeals: 2,
    });
    expect(performance.items[0].financials[0]).toMatchObject({ revenue: '0', roi: '-100' });
  });

  it('returns null rates with reasons for empty denominators while counts stay zero', async () => {
    const rates = await analytics.conversionRates({ ...october, campaignId: 'cmp-none' });

    expect(rates).toMatchObject({
      campaignId: 'cmp-none',
      leads: 0,
      convertedLeads: 0,
      leadToDealRate: null,
      leadToWonRate: null,
      dealToWonRate: null,
      reasons: {
        leadToDealRate: 'zero_leads',
        leadToWonRate: 'zero_leads',
        dealToWonRate: 'zero_converted_leads',
      },
    });

    await fixtures.saveLead({ firstTouchAt: inPeriod(1), campaignId: 'cmp-none' });
    await bump();
    expect(await analytics.conversionRates({ ...october, campaignId: 'cmp-none' })).toMatchObject({
      leads: 1,
      leadToDealRate: '0',
      dealToWonRate: null,
    });
  });

  it('withholds ratios when a cost day or a won amount is missing', async () => {
    const [first, second] = await Promise.all(
      [1, 2].map(() => fixtures.saveLead({ firstTouchAt: inPeriod(1) })),
    );
    await fixtures.saveDeal({ leadId: first, stageSemantics: 'won', amount: '500' });
    await fixtures.saveDeal({ leadId: second, stageSemantics: 'won', amount: null });
    await fixtures.saveLead({ firstTouchAt: inPeriod(1), campaignId: 'cmp-2' });
    await saveCosts([
      { reportDate: '2026-10-01', spend: '100' },
      { reportDate: '2026-10-02', spend: '100' },
      { reportDate: '2026-10-03', spend: '100' },
      { campaignId: 'cmp-2', reportDate: '2026-10-01', spend: '40' },
      { campaignId: 'cmp-3', reportDate: '2026-10-01', spend: '5' },
      { campaignId: 'cmp-3', reportDate: '2026-10-02', spend: '5' },
      { campaignId: 'cmp-3', reportDate: '2026-10-03', spend: '5' },
    ]);

    const performance = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });
    const byCampaign = Object.fromEntries(performance.items.map((item) => [item.campaignId, item]));

    expect(byCampaign['cmp-1']).toMatchObject({
      revenueComplete: false,
      missingAmountDeals: 1,
      financials: [
        {
          knownSpend: '300',
          revenue: '500',
          cpl: '150',
          roi: null,
          roas: null,
          reasons: { roi: 'revenue_incomplete' },
        },
      ],
    });
    expect(byCampaign['cmp-2']).toMatchObject({
      spendComplete: false,
      financials: [
        {
          knownSpend: '40',
          coveredDays: 1,
          requestedDays: 3,
          cpl: null,
          roi: null,
          reasons: { cpl: 'spend_incomplete' },
        },
      ],
    });
    expect(byCampaign['cmp-3']).toMatchObject({
      leads: 0,
      leadToDealRate: null,
      financials: [{ knownSpend: '15', cpl: null, reasons: { cpl: 'zero_leads' } }],
    });
  });

  it('reports spend and revenue per currency without adding currencies together', async () => {
    const [first, second] = await Promise.all(
      [1, 2].map(() => fixtures.saveLead({ firstTouchAt: inPeriod(1) })),
    );
    await fixtures.saveDeal({
      leadId: first,
      stageSemantics: 'won',
      amount: '900',
      currency: 'VND',
    });
    await fixtures.saveDeal({
      leadId: second,
      stageSemantics: 'won',
      amount: '30',
      currency: 'USD',
    });
    await saveCosts([
      { reportDate: '2026-10-01', spend: '100' },
      { reportDate: '2026-10-02', spend: '100' },
      { reportDate: '2026-10-03', spend: '100' },
    ]);

    const all = await analytics.campaignPerformance({ ...october, page: 1, limit: 20 });
    const usd = await analytics.campaignPerformance({
      ...october,
      currency: 'USD',
      page: 1,
      limit: 20,
    });

    expect(all.items[0].financials).toEqual([
      expect.objectContaining({ currency: 'USD', knownSpend: null, revenue: '30', roi: null }),
      expect.objectContaining({ currency: 'VND', knownSpend: '300', revenue: '900', roi: '200' }),
    ]);
    expect(usd.items[0].financials).toEqual([expect.objectContaining({ currency: 'USD' })]);
  });

  it('paginates campaigns, isolates advertisers and reports unattributed leads', async () => {
    for (const campaignId of ['cmp-a', 'cmp-b', 'cmp-c']) {
      await fixtures.saveLead({ firstTouchAt: inPeriod(1), campaignId });
    }
    await fixtures.saveLead({ firstTouchAt: inPeriod(1), campaignId: null });
    await fixtures.saveLead({
      firstTouchAt: inPeriod(1),
      campaignId: 'cmp-foreign',
      advertiserId: 'someone-else',
    });
    await bump();

    const page = await analytics.campaignPerformance({ ...october, page: 2, limit: 2 });

    expect(page).toMatchObject({ total: 3, page: 2, limit: 2, unattributedLeads: 1 });
    expect(page.items.map((item) => item.campaignId)).toEqual(['cmp-c']);
    expect((await analytics.conversionRates(october)).leads).toBe(4);
  });

  it('rejects hour-level ranges and foreign timezones for campaign performance', async () => {
    await expect(
      analytics.campaignPerformance({
        from: '2026-10-01T00:00:00+07:00',
        to: '2026-10-02T06:00:00+07:00',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      analytics.campaignPerformance({
        from: '2026-10-01',
        to: '2026-10-02',
        timezone: 'America/New_York',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      analytics.conversionRates({ from: '2026-10-01T03:15:00Z', to: '2026-10-02T09:45:00Z' }),
    ).resolves.toMatchObject({ leads: 0 });
  });

  it('flags the response as stale while an old operation is still pending', async () => {
    await infrastructure.database.dataSource.getRepository(OperationEntity).save({
      id: '018f0000-0000-7000-8000-000000000001',
      operationKey: 'analytics-stale-probe',
      kind: 'bitrix_lead_sync',
      status: 'pending',
      attempt: 0,
      payload: {},
      configRevisions: {},
      createdAt: new Date(Date.now() - 120_000),
      updatedAt: new Date(Date.now() - 120_000),
    });
    await bump();

    const rates = await analytics.conversionRates(october);

    expect(rates.stale).toBe(true);
    expect(rates.oldestPendingAt).not.toBeNull();
  });

  it('reads from PostgreSQL when Redis is unavailable', async () => {
    await fixtures.saveLead({ firstTouchAt: inPeriod(1) });
    await bump();
    const offline = new AnalyticsService(
      repository,
      costs,
      new AnalyticsCache({
        get: () => Promise.reject(new Error('redis down')),
        set: () => Promise.reject(new Error('redis down')),
      }),
      scope,
      () => NOW,
    );

    expect((await offline.conversionRates(october)).leads).toBe(1);
    expect(
      await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).count(),
    ).toBe(0);
  });
});
