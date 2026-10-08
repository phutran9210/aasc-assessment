import { randomUUID } from 'node:crypto';

import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { DealHistoryEntity } from '@modules/crm-integration/entities/deal-history.entity.js';
import { DealPollCheckpointEntity } from '@modules/crm-integration/entities/deal-poll-checkpoint.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { DealHistoryRepository } from '@modules/crm-integration/repositories/deal-history.repository.js';
import { DealRefreshService } from '@modules/crm-integration/services/deal-refresh.service.js';
import { DealPollService } from '@modules/crm-integration/services/deal-poll.service.js';
import { DealPollRepository } from '@modules/crm-integration/repositories/deal-poll.repository.js';
import { AggregateLeaseRepository } from '@core/queue/repositories/aggregate-lease.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { DealRepository } from '@modules/crm-integration/repositories/deal.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import type { CrmGateway, RemoteDeal } from '@modules/crm-integration/ports/crm-gateway.port.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

describe('Bitrix deal event reconciliation', () => {
  let infrastructure: TestInfrastructure;
  let refresh: DealRefreshService;
  let dealId: string;
  let remote: RemoteDeal;
  let leases: AggregateLeaseRepository;
  let polls: DealPollService;
  const gateway = {
    getDeal: jest.fn(() => Promise.resolve(remote)),
    metadata: jest.fn().mockResolvedValue({
      stages: [
        { id: 'C1:NEW', name: 'New', categoryId: 1, semantic: null },
        { id: 'C1:WON', name: 'Won', categoryId: 1, semantic: 'S' },
        { id: 'C1:LOST', name: 'Lost', categoryId: 1, semantic: 'F' },
      ],
    }),
  } as unknown as CrmGateway;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    leases = new AggregateLeaseRepository(infrastructure.database.dataSource);
    refresh = new DealRefreshService(
      infrastructure.database.dataSource,
      gateway,
      new DealHistoryRepository(),
      new DealRepository(infrastructure.database.dataSource),
      new OperationRepository(),
      new WebhookEventRepository(),
      new AnalyticsRevisionRepository(),
    );
    polls = new DealPollService(
      infrastructure.database.dataSource,
      gateway,
      new OperationRepository(),
      new OutboxRepository(),
      new DealPollRepository(infrastructure.database.dataSource),
    );
  });

  beforeEach(async () => {
    const source = infrastructure.database.dataSource;
    await source.getRepository(DealHistoryEntity).createQueryBuilder().delete().execute();
    await source.getRepository(OutboxEntity).createQueryBuilder().delete().execute();
    await source.getRepository(OperationEntity).createQueryBuilder().delete().execute();
    await source.getRepository(DealPollCheckpointEntity).createQueryBuilder().delete().execute();
    await source.getRepository(DealEntity).createQueryBuilder().delete().execute();
    await source.getRepository(LeadEntity).createQueryBuilder().delete().execute();
    const leadId = randomUUID();
    await source.getRepository(LeadEntity).save({
      id: leadId,
      externalId: `test:${leadId}`,
      advertiserId: 'event-test',
      scopeKey: 'event-test',
      portalKey: 'mock-portal',
      providerMode: 'mock',
      name: 'Event test',
      email: null,
      phone: null,
      city: null,
      firstTouchAt: new Date('2026-01-01T00:00:00Z'),
      firstTouchCampaignId: null,
      lastTouchAt: null,
      convertedAt: null,
      dealCreatedAt: null,
      bitrixLeadId: 'lead-1',
      firstSubmissionId: null,
      lastSubmissionId: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      lastErrorCode: null,
    });
    dealId = randomUUID();
    await source.getRepository(DealEntity).save({
      id: dealId,
      leadId,
      portalKey: 'mock-portal',
      bitrixDealId: '42',
      title: 'TikTok deal',
      amount: null,
      currency: null,
      pipelineId: '1',
      stageId: 'C1:NEW',
      stageSemantics: 'open',
      stageDeletedAt: null,
      probability: 10,
      assignedTo: '1',
      ruleRevision: 1,
      conversionStatus: 'completed',
      remoteModifiedAt: null,
      everWonAt: null,
      currentSnapshotHash: null,
      version: 1,
    });
    remote = makeRemote('C1:NEW', '2026-10-08T12:00:00.000Z', '500');
    gateway.getDeal = jest.fn(() => Promise.resolve(remote));
    gateway.listDealsPage = jest.fn(() =>
      Promise.resolve([remote, { ...remote, id: 'unmanaged', marker: null }]),
    );
  });

  afterAll(async () => infrastructure?.close());

  it('uses remote stage and amount, deduplicates snapshots, and ignores an older callback', async () => {
    await refresh.refresh('42', context());
    const history = infrastructure.database.dataSource.getRepository(DealHistoryEntity);
    expect(await history.count()).toBe(1);
    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({
      stageId: 'C1:NEW',
      amount: '500.0000',
      probability: 10,
    });

    await refresh.refresh('42', context());
    expect(await history.count()).toBe(1);

    remote = makeRemote('C1:WON', '2026-10-08T12:00:00.000Z', '700');
    await refresh.refresh('42', context());
    expect(gateway.getDeal).toHaveBeenCalledTimes(4);
    expect(await history.count()).toBe(2);
    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({
      stageSemantics: 'won',
      probability: 100,
      amount: '700.0000',
    });

    remote = makeRemote('C1:LOST', '2026-10-08T11:59:00.000Z', '0');
    await refresh.refresh('42', context());
    expect(await history.count()).toBe(2);
    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({ stageSemantics: 'won' });
  });

  it('ignores the callback stage fields and reconciles the current remote snapshot', async () => {
    remote = makeRemote('C1:WON', '2026-10-08T12:01:00.000Z', '700');
    const eventId = randomUUID();
    await infrastructure.database.dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'bitrix24',
      providerMode: 'mock',
      scopeKey: 'mock-portal',
      portalKey: 'mock-portal',
      eventKey: 'forged-stage-callback',
      eventType: 'deal.update',
      occurredAt: new Date('2026-10-08T12:01:00Z'),
      rawBody: Buffer.from('{}'),
      payload: { eventType: 'deal.update', remoteId: '42', stageId: 'C1:LOST' },
      payloadHash: 'e'.repeat(64),
    });
    const operation = await new OperationRepository().ensure(
      {
        operationKey: `refresh/${eventId}`,
        kind: 'bitrix_deal_refresh',
        aggregateId: dealId,
        payload: { eventId, remoteId: '42' },
      },
      infrastructure.database.dataSource.manager,
    );
    await refresh.refresh('42', context(operation.id));

    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({ stageId: 'C1:WON', stageSemantics: 'won', probability: 100 });
  });

  it('links a create-response-race callback without completing the conversion saga early', async () => {
    remote = makeRemote('C1:NEW', '2026-10-08T12:01:00.000Z', '500');
    remote.marker = `aasc-tiktok/deal/${dealId}`;
    await infrastructure.database.dataSource.getRepository(DealEntity).update(dealId, {
      bitrixDealId: null,
      conversionStatus: 'creating_deal',
    });

    await refresh.refresh('42', context());

    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({ bitrixDealId: '42', conversionStatus: 'creating_deal' });
  });

  it('records reopen and second win as distinct observed history without counting revenue twice', async () => {
    for (const [stage, timestamp, amount] of [
      ['C1:WON', '2026-10-08T12:01:00.000Z', '700'],
      ['C1:NEW', '2026-10-08T12:02:00.000Z', '700'],
      ['C1:WON', '2026-10-08T12:03:00.000Z', '700'],
    ]) {
      remote = makeRemote(stage, timestamp, amount);
      await refresh.refresh('42', context());
    }
    expect(await infrastructure.database.dataSource.getRepository(DealHistoryEntity).count()).toBe(
      3,
    );
    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({ stageSemantics: 'won', probability: 100 });
  });

  it('uses a delete tombstone without erasing the latest stage or its history', async () => {
    const deal = await infrastructure.database.dataSource
      .getRepository(DealEntity)
      .findOneByOrFail({ id: dealId });
    await infrastructure.database.dataSource.getRepository(DealEntity).update(deal.id, {
      currentSnapshotHash: 'known-hash',
      remoteModifiedAt: new Date('2026-10-08T12:00:00Z'),
    });
    const eventId = randomUUID();
    const event = await infrastructure.database.dataSource
      .getRepository('integration_webhook_event')
      .save({
        id: eventId,
        provider: 'bitrix24',
        providerMode: 'mock',
        scopeKey: 'mock-portal',
        portalKey: 'mock-portal',
        eventKey: 'delete-event',
        eventType: 'deal.delete',
        occurredAt: new Date('2026-10-08T12:10:00Z'),
        rawBody: Buffer.from('{}'),
        payload: {},
        payloadHash: 'd'.repeat(64),
      });
    const operationId = randomUUID();
    await infrastructure.database.dataSource.getRepository('integration_operation').save({
      id: operationId,
      operationKey: `delete/${eventId}`,
      kind: 'bitrix_deal_refresh',
      aggregateId: dealId,
      targetVersion: null,
      payload: { eventId, remoteId: '42' },
      configRevisions: {},
      actorId: null,
      status: 'processing',
      attempt: 1,
      leaseUntil: null,
      leaseToken: null,
      remoteId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      nextAttemptAt: null,
      completedAt: null,
    });
    await refresh.refresh('42', context(operationId));
    await refresh.refresh('42', context(operationId));
    expect(
      await infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: dealId }),
    ).toMatchObject({
      stageId: 'C1:NEW',
      stageDeletedAt: expect.any(Date),
    });
    expect(await infrastructure.database.dataSource.getRepository(DealHistoryEntity).count()).toBe(
      1,
    );
    expect(event).toBeDefined();
  });

  it('polls overlapping incremental pages and full scans only managed remote IDs', async () => {
    const first = await polls.run('incremental');
    expect(first).toMatchObject({
      mode: 'incremental',
      scanned: 2,
      queued: 1,
      ignored: 1,
      complete: true,
    });
    expect(await infrastructure.database.dataSource.getRepository(OutboxEntity).count()).toBe(1);
    const checkpoint = await infrastructure.database.dataSource
      .getRepository(DealPollCheckpointEntity)
      .findOneByOrFail({ portalKey: 'mock-portal' });
    expect(checkpoint.incrementalWatermark).toEqual(expect.any(Date));

    await polls.run('incremental');
    expect(gateway.listDealsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ modifiedSince: expect.any(Date) }),
    );
    const full = await polls.run('full');
    expect(full).toMatchObject({ mode: 'full', scanned: 1, queued: 1, ignored: 0, complete: true });
    expect(
      (
        await infrastructure.database.dataSource
          .getRepository(DealPollCheckpointEntity)
          .findOneByOrFail({ portalKey: 'mock-portal' })
      ).fullScanAt,
    ).toEqual(expect.any(Date));
  });

  function context(operationId: string = randomUUID()): OperationContext {
    return {
      operationId,
      ownerToken: randomUUID(),
      attempt: 1,
      revisions: {},
      signal: new AbortController().signal,
      assertOwnership: () => Promise.resolve(),
      acquireAggregateLease: (key) => leases.claim(key, 30_000),
      releaseAggregateLease: (lease) => leases.release(lease),
    };
  }
});

function makeRemote(stageId: string, updatedTime: string, opportunity: string): RemoteDeal {
  return {
    id: '42',
    title: 'TikTok deal',
    marker: `aasc-tiktok/deal/${dealIdForRemote}`,
    fields: {
      categoryId: 1,
      stageId,
      updatedTime,
      opportunity,
      currencyId: 'VND',
      assignedById: 1,
      probability: 10,
    },
  };
}

const dealIdForRemote = '00000000-0000-7000-8000-000000000001';
