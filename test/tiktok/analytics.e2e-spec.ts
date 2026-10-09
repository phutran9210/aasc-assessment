import { randomUUID } from 'node:crypto';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';
const ADVERTISER = 'advertiser-analytics-e2e';
const day = (value: number) => new Date(Date.UTC(2026, 8, value, 5));

describe('analytics API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let analystToken: string;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    testApp = await createTestApp({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
      INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      TIKTOK_ADVERTISER_ID: ADVERTISER,
      REPORT_TIMEZONE: 'Asia/Ho_Chi_Minh',
    });
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));

    const bcrypt = await import('bcrypt');
    const username = `analytics-analyst-${randomUUID()}`;
    await dataSource.getRepository(IntegrationUserEntity).save({
      id: randomUUID(),
      username,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roles: ['integration_analyst'],
      active: true,
      authVersion: 1,
    });
    const login = await request(testApp.app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    analystToken = login.body.accessToken as string;

    // AC18: ten leads, four converted, two won for 3,000,000 VND against 1,000,000 VND of spend.
    const fixtures = analyticsFixtures(dataSource, ADVERTISER);
    const leadIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      leadIds.push(await fixtures.saveLead({ firstTouchAt: day(1 + (index % 2)), score: 70 }));
    }
    for (const [index, leadId] of leadIds.slice(0, 4).entries()) {
      await fixtures.saveDeal({
        leadId,
        stageSemantics: index < 2 ? 'won' : 'open',
        amount: '1500000',
      });
    }
    await dataSource.transaction((tx) =>
      testApp.app.get(CampaignCostService).upsert(
        ['2026-09-01', '2026-09-02'].map((reportDate) => ({
          advertiserId: ADVERTISER,
          campaignId: 'cmp-1',
          reportDate,
          reportingTimezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          spend: '500000',
        })),
        'import',
        tx,
      ),
    );
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
  });

  const get = (path: string) =>
    request(testApp.app.getHttpServer()).get(path).set('Authorization', `Bearer ${analystToken}`);

  it('requires authentication', async () => {
    await request(testApp.app.getHttpServer())
      .get('/api/v1/analytics/conversion-rates')
      .expect(401);
    await request(testApp.app.getHttpServer())
      .get('/api/v1/analytics/campaign-performance')
      .expect(401);
  });

  it('returns cohort rates with period, basis and freshness metadata', async () => {
    const response = await get(
      '/api/v1/analytics/conversion-rates?from=2026-09-01&to=2026-09-03&campaign_id=cmp-1',
    ).expect(200);

    expect(response.body).toMatchObject({
      campaignId: 'cmp-1',
      leads: 10,
      convertedLeads: 4,
      wonLeads: 2,
      leadToDealRate: '40',
      leadToWonRate: '20',
      dealToWonRate: '50',
      period: {
        from: '2026-08-31T17:00:00.000Z',
        to: '2026-09-02T17:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      attributionModel: 'first_touch',
      revenueBasis: 'cohort_to_date',
      providerMode: { tiktok: 'mock', bitrix: 'mock' },
      stale: false,
    });
    expect(typeof response.body.generatedAt).toBe('string');
    expect(typeof response.body.dataAsOf).toBe('string');
  });

  it('returns CPL 100000, ROI 200 and ROAS 3 for the acceptance cohort', async () => {
    const response = await get(
      '/api/v1/analytics/campaign-performance?from=2026-09-01&to=2026-09-03&currency=VND&page=1&limit=10',
    ).expect(200);

    expect(response.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(response.body.items[0]).toMatchObject({
      campaignId: 'cmp-1',
      leads: 10,
      qualityScore: '70',
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
  });

  it('returns null ratios with known spend when a cost day is missing', async () => {
    const response = await get(
      '/api/v1/analytics/campaign-performance?from=2026-09-01&to=2026-09-04',
    ).expect(200);

    expect(response.body.items[0]).toMatchObject({
      spendComplete: false,
      financials: [
        {
          knownSpend: '1000000',
          cpl: null,
          roi: null,
          roas: null,
          reasons: { cpl: 'spend_incomplete' },
        },
      ],
    });
  });

  it('reflects a committed change on the next request through the revision', async () => {
    const path = '/api/v1/analytics/conversion-rates?from=2026-09-10&to=2026-09-11';
    expect((await get(path).expect(200)).body.leads).toBe(0);

    await dataSource.transaction(async (tx) => {
      await analyticsFixtures(dataSource, ADVERTISER).saveLead({ firstTouchAt: day(10) });
      await testApp.app.get(AnalyticsRevisionRepository).increment(tx);
    });

    expect((await get(path).expect(200)).body.leads).toBe(1);
  });

  it.each([
    ['/api/v1/analytics/conversion-rates?timezone=Mars/Olympus'],
    ['/api/v1/analytics/conversion-rates?date_range=30d&from=2026-09-01&to=2026-09-02'],
    ['/api/v1/analytics/conversion-rates?from=2026-09-02'],
    ['/api/v1/analytics/conversion-rates?unknown=1'],
    [
      '/api/v1/analytics/campaign-performance?from=2026-09-01T00:00:00%2B07:00&to=2026-09-02T06:00:00%2B07:00',
    ],
    ['/api/v1/analytics/campaign-performance?timezone=America/New_York'],
    ['/api/v1/analytics/campaign-performance?currency=dong'],
    ['/api/v1/analytics/campaign-performance?limit=100000'],
  ])('rejects %s with 400', async (path) => {
    await get(path).expect(400);
  });

  it('applies the default 30 day windows', async () => {
    const rates = await get('/api/v1/analytics/conversion-rates?date_range=7d').expect(200);
    const performance = await get('/api/v1/analytics/campaign-performance').expect(200);

    const span =
      Date.parse(performance.body.period.to as string) -
      Date.parse(performance.body.period.from as string);
    expect(span).toBe(30 * 86_400_000);
    expect(
      Date.parse(rates.body.period.to as string) - Date.parse(rates.body.period.from as string),
    ).toBe(7 * 86_400_000);
  });
});
