import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { AnalyticsRepository } from '@modules/integration-analytics/repositories/analytics.repository.js';
import { ScoreRecomputeService } from '@modules/integration-analytics/services/score-recompute.service.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const AS_OF = '2026-10-09T00:00:00.000Z';
const daysAgo = (days: number) => new Date(Date.parse(AS_OF) - days * 86_400_000);

describe('daily score recompute', () => {
  let infrastructure: TestInfrastructure;
  let recompute: ScoreRecomputeService;
  let analytics: AnalyticsRepository;
  let fixtures: ReturnType<typeof analyticsFixtures>;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    const dataSource = infrastructure.database.dataSource;
    analytics = new AnalyticsRepository(dataSource);
    recompute = new ScoreRecomputeService(
      dataSource,
      analytics,
      new LeadRepository(),
      new SubmissionRepository(),
      new ConfigurationRepository(dataSource),
      new OperationRepository(),
      new OutboxRepository(),
      new AnalyticsRevisionRepository(),
    );
    fixtures = analyticsFixtures(dataSource, 'advertiser-score');
  });

  afterAll(async () => {
    await infrastructure.close();
  });

  async function leadWithInteractions(ages: number[], applyRules = true): Promise<string> {
    const leadId = await fixtures.saveLead({
      firstTouchAt: daysAgo(60),
      score: 35 + ages.length * 5,
      scoreBreakdown: {
        email: 15,
        phone: 0,
        form: 20,
        interaction: ages.length * 5,
        budget: 0,
        timeline: 0,
      },
    });
    await fixtures.saveSubmission({
      leadId,
      occurredAt: daysAgo(60),
      applyRules,
      isHistorical: !applyRules,
    });
    for (const age of ages) {
      await fixtures.saveSubmission({
        leadId,
        occurredAt: daysAgo(age),
        event: 'click',
        applyRules,
      });
    }
    return leadId;
  }

  const lead = (id: string) =>
    infrastructure.database.dataSource.getRepository(LeadEntity).findOneByOrFail({ id });
  const operations = (leadId: string) =>
    infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .find({ where: { aggregateId: leadId } });

  it('drops interactions that left the 30 day window and queues one lead sync', async () => {
    const aged = await leadWithInteractions([40, 5]);
    const fresh = await leadWithInteractions([3, 2]);
    const before = BigInt(await analytics.revision());

    expect(await recompute.run(AS_OF)).toBe(1);

    expect(await lead(aged)).toMatchObject({
      score: 40,
      version: 2,
      scoreBreakdown: expect.objectContaining({ interaction: 5 }),
    });
    expect(await lead(fresh)).toMatchObject({ score: 45, version: 1 });
    expect(await operations(aged)).toEqual([
      expect.objectContaining({
        operationKey: `bitrix-lead-sync/${aged}/2`,
        kind: 'bitrix_lead_sync',
        targetVersion: 2,
        status: 'pending',
      }),
    ]);
    expect(await operations(fresh)).toEqual([]);
    expect(BigInt(await analytics.revision())).toBe(before + 1n);
  });

  it('is idempotent: a second run changes nothing and queues nothing', async () => {
    const aged = await leadWithInteractions([45]);

    expect(await recompute.run(AS_OF)).toBe(1);
    const revision = await analytics.revision();
    expect(await recompute.run(AS_OF)).toBe(0);

    expect(await operations(aged)).toHaveLength(1);
    expect(await analytics.revision()).toBe(revision);
    expect(
      await infrastructure.database.dataSource
        .getRepository(OutboxEntity)
        .count({ where: { operationId: (await operations(aged))[0].id } }),
    ).toBe(1);
  });

  it('routes an imported lead through the same sync operation instead of converting it', async () => {
    const imported = await leadWithInteractions([50], false);

    expect(await recompute.run(AS_OF)).toBe(1);

    const queued = await operations(imported);
    expect(queued.map((operation) => operation.kind)).toEqual(['bitrix_lead_sync']);
  });

  it('walks every candidate across batches', async () => {
    const ids = [];
    for (let index = 0; index < 5; index += 1) ids.push(await leadWithInteractions([31]));

    expect(await recompute.run(AS_OF, 2)).toBe(5);
    for (const id of ids) expect((await lead(id)).score).toBe(35);
  });
});
