import { Queue } from 'bullmq';
import { ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { OutboxDispatcherService } from '@core/queue/services/outbox-dispatcher.service.js';
import { AggregateLeaseRepository } from '@core/queue/repositories/aggregate-lease.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import type { AggregateLease } from '@core/queue/types/operation.types.js';
import type { QueueName } from '@core/queue/types/operation.types.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const rawBody = Buffer.from('{"event_id":"event-1","lead_id":"lead-1"}');
const payload = { event_id: 'event-1', lead_id: 'lead-1' };
const payloadHash = createHash('sha256').update(rawBody).digest('hex');

describe('TikTok durable inbox and outbox', () => {
  let infrastructure: TestInfrastructure;
  let inbox: WebhookEventRepository;
  let operations: OperationRepository;
  let outbox: OutboxRepository;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    inbox = new WebhookEventRepository();
    operations = new OperationRepository();
    outbox = new OutboxRepository();
  });

  afterAll(async () => infrastructure.close());

  it('deduplicates 20 concurrent inserts and rejects the same key with a different hash', async () => {
    const eventKey = `event-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => acceptAndSchedule(eventKey, payloadHash)),
    );

    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.map((result) => result.eventId).every((id) => id === results[0]?.eventId)).toBe(
      true,
    );
    await expect(acceptAndSchedule(eventKey, 'f'.repeat(64))).rejects.toBeInstanceOf(
      ConflictException,
    );

    const { dataSource } = infrastructure.database;
    expect(await dataSource.getRepository(WebhookEventEntity).count({ where: { eventKey } })).toBe(
      1,
    );
    expect(
      await dataSource.getRepository(OperationEntity).count({ where: { operationKey: eventKey } }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(OutboxEntity).count({ where: { queue: 'tiktok-ingest' } }),
    ).toBe(1);
  });

  it('rolls the event, operation and outbox back together', async () => {
    const eventKey = `rollback-${randomUUID()}`;
    const outboxCountBefore = await infrastructure.database.dataSource
      .getRepository(OutboxEntity)
      .count();
    await expect(
      infrastructure.database.dataSource.transaction(async (manager) => {
        const accepted = await inbox.accept(eventInput(eventKey, payloadHash), manager);
        const operation = await operations.ensure(
          { operationKey: eventKey, kind: 'tiktok_ingest', payload: { eventId: accepted.eventId } },
          manager,
        );
        await outbox.append(operation.id, 'tiktok-ingest', new Date(), manager);
        throw new Error('rollback all writes');
      }),
    ).rejects.toThrow('rollback all writes');

    expect(
      await infrastructure.database.dataSource
        .getRepository(WebhookEventEntity)
        .count({ where: { eventKey } }),
    ).toBe(0);
    expect(
      await infrastructure.database.dataSource
        .getRepository(OperationEntity)
        .count({ where: { operationKey: eventKey } }),
    ).toBe(0);
    expect(await infrastructure.database.dataSource.getRepository(OutboxEntity).count()).toBe(
      outboxCountBefore,
    );
  });

  it('reuses the same queue job after enqueue succeeds but published marking crashes', async () => {
    const { dataSource } = infrastructure.database;
    const eventKey = `dispatch-${randomUUID()}`;
    let operationId = '';
    await dataSource.transaction(async (manager) => {
      const operation = await operations.ensure(
        { operationKey: eventKey, kind: 'bitrix_lead_sync', payload: { leadId: randomUUID() } },
        manager,
      );
      operationId = operation.id;
      await outbox.append(operation.id, 'bitrix-lead-sync', new Date(), manager);
    });

    const queue = new Queue('bitrix-lead-sync', {
      connection: infrastructure.redis.producer(),
      prefix: infrastructure.redisPrefix,
    });
    await queue.waitUntilReady();
    const queueMap = new Map<QueueName, Queue>([['bitrix-lead-sync', queue]]);
    let shouldCrash = true;
    const dispatcher = new (class extends OutboxDispatcherService {
      protected override async markPublished(id: string, ownerToken: string): Promise<boolean> {
        if (shouldCrash) {
          shouldCrash = false;
          throw new Error('simulated process crash after queue add');
        }
        return super.markPublished(id, ownerToken);
      }
    })(dataSource, queueMap, 5);

    try {
      await expect(dispatcher.dispatchOnce(10)).rejects.toThrow('simulated process crash');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(dispatcher.dispatchOnce(10)).resolves.toBe(1);

      const job = await queue.getJob(`${operationId}-1`);
      expect(job).not.toBeNull();
      expect(job?.data).toEqual({ operationId });
      expect(await queue.getJobCounts('waiting', 'active', 'completed', 'failed')).toMatchObject({
        waiting: 1,
      });
    } finally {
      await queue.close();
    }
  });

  it('allows only the current aggregate lease owner to renew or release', async () => {
    const leases = new AggregateLeaseRepository(infrastructure.database.dataSource);
    const key = `lead:${randomUUID()}`;
    const first = requireLease(await leases.claim(key, 5));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = requireLease(await leases.claim(key, 30_000));
    await expect(leases.renew(first, 30_000)).resolves.toBeNull();
    await expect(leases.release(first)).resolves.toBe(false);
    await expect(leases.release(second)).resolves.toBe(true);
  });

  async function acceptAndSchedule(eventKey: string, hash: string) {
    return infrastructure.database.dataSource.transaction(async (manager) => {
      const accepted = await inbox.accept(eventInput(eventKey, hash), manager);
      if (!accepted.duplicate) {
        const operation = await operations.ensure(
          { operationKey: eventKey, kind: 'tiktok_ingest', payload: { eventId: accepted.eventId } },
          manager,
        );
        await outbox.append(operation.id, 'tiktok-ingest', new Date(Date.now() + 60_000), manager);
      }
      return accepted;
    });
  }
});

function requireLease(lease: AggregateLease | null): AggregateLease {
  if (!lease) throw new Error('Expected an aggregate lease');
  return lease;
}

function eventInput(eventKey: string, hash: string) {
  return {
    provider: 'tiktok' as const,
    providerMode: 'mock',
    scopeKey: 'advertiser-test',
    advertiserId: 'advertiser-test',
    portalKey: null,
    eventKey,
    eventType: 'lead.created',
    occurredAt: new Date(),
    rawBody,
    payload,
    payloadHash: hash,
  };
}
