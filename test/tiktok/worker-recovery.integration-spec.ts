import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { IsNull } from 'typeorm';

import { AggregateLeaseRepository } from '@core/queue/repositories/aggregate-lease.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OperationRunnerService } from '@core/queue/services/operation-runner.service.js';
import { RecoverySweeperService } from '@core/queue/services/recovery-sweeper.service.js';
import { OperationFailure, RetryPolicy } from '@core/queue/services/retry-policy.service.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import type { OperationHandlerRegistry } from '@core/queue/types/worker.types.js';
import { OPERATION_QUEUE, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { OperationKind } from '@core/queue/types/operation.types.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import { TiktokWorkerModule } from '@/apps/tiktok/worker.module.js';

const originalEnvironment = new Map(
  [
    'TIKTOK_DATABASE_URL',
    'TIKTOK_DATABASE_SCHEMA',
    'TIKTOK_REDIS_URL',
    'INTEGRATION_QUEUE_PREFIX',
  ].map((key) => [key, process.env[key]]),
);
describe('worker recovery', () => {
  let infrastructure: Awaited<ReturnType<typeof createTestInfrastructure>>;
  let operations: OperationRepository;
  let outbox: OutboxRepository;
  let aggregateLeases: AggregateLeaseRepository;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    operations = new OperationRepository();
    outbox = new OutboxRepository();
    aggregateLeases = new AggregateLeaseRepository(infrastructure.database.dataSource);
  });

  afterAll(async () => {
    if (infrastructure) await infrastructure.close();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function createOperation(
    key = randomUUID(),
    kind: OperationKind = 'tiktok_ingest',
  ): Promise<string> {
    return infrastructure.database.dataSource.transaction(async (manager) => {
      const operation = await operations.ensure({ operationKey: `worker/${key}`, kind }, manager);
      await outbox.append(operation.id, OPERATION_QUEUE[kind], new Date(), manager);
      return operation.id;
    });
  }

  function runner(handlers: OperationHandlerRegistry, policy = new RetryPolicy()) {
    return new OperationRunnerService(
      infrastructure.database.dataSource,
      handlers,
      aggregateLeases,
      outbox,
      policy,
    );
  }

  it('does not rerun a succeeded operation when a deleted or replayed job is delivered', async () => {
    let calls = 0;
    const operationId = await createOperation();
    const service = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: () => {
              calls += 1;
              return Promise.resolve({ outcome: 'succeeded' as const });
            },
          },
        ],
      ]),
    );

    await expect(service.run(operationId)).resolves.toEqual({ outcome: 'succeeded' });
    await expect(service.run(operationId)).resolves.toBeNull();
    expect(calls).toBe(1);
    await expect(
      infrastructure.database.dataSource.getRepository(OperationEntity).findOneByOrFail({
        id: operationId,
      }),
    ).resolves.toMatchObject({ status: 'succeeded', attempt: 1 });
  });

  it('persists retry generations and sends the fifth transient failure to the DLQ', async () => {
    const operationId = await createOperation();
    const service = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: () => Promise.reject(new OperationFailure('transient', 'UPSTREAM_503')),
          },
        ],
      ]),
      new RetryPolicy({ baseDelayMs: 1, maxDelayMs: 1, random: () => 0 }),
    );

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await service.run(operationId);
      if (attempt < 5) {
        await infrastructure.database.dataSource
          .getRepository(OperationEntity)
          .update({ id: operationId }, { nextAttemptAt: new Date(Date.now() - 1) });
      }
    }

    const operation = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: operationId });
    expect(operation).toMatchObject({
      status: 'dead_letter',
      attempt: 5,
      lastErrorCode: 'UPSTREAM_503',
    });
    const systemOperations = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findBy([
        { operationKey: `dlq/${operationId}` },
        { operationKey: `dlq-notification/${operationId}` },
      ]);
    expect(systemOperations).toHaveLength(2);
    const systemOperationIds = systemOperations.map((operation) => operation.id);
    const queueEntries = await infrastructure.database.dataSource
      .getRepository(OutboxEntity)
      .findBy(systemOperationIds.map((operationId) => ({ operationId })));
    expect(queueEntries.map((entry) => entry.queue).sort()).toEqual(
      [QUEUE_NAMES.integrationDlq, QUEUE_NAMES.integrationNotification].sort(),
    );
  });

  it('sends ambiguous mutation timeouts to reconciliation and never starts another mutation after lease loss', async () => {
    const timeoutOperationId = await createOperation();
    const timeoutRunner = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: () =>
              Promise.reject(new OperationFailure('mutation_timeout', 'REMOTE_TIMEOUT')),
          },
        ],
      ]),
    );
    await timeoutRunner.run(timeoutOperationId);
    await expect(
      infrastructure.database.dataSource.getRepository(OperationEntity).findOneByOrFail({
        id: timeoutOperationId,
      }),
    ).resolves.toMatchObject({ status: 'reconcile_required', attempt: 1 });

    const leaseOperationId = await createOperation();
    let remoteMutations = 0;
    const leaseRunner = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: async (context) => {
              const lease = await context.acquireAggregateLease(`lead/${leaseOperationId}`);
              if (!lease) throw new Error('lease not acquired');
              remoteMutations += 1;
              await infrastructure.database.dataSource.query(
                `UPDATE "${infrastructure.database.schema}".integration_aggregate_lease
                 SET expires_at = NOW() - INTERVAL '1 second' WHERE lease_key = $1`,
                [lease.key],
              );
              await aggregateLeases.claim(lease.key, 60_000);
              await context.assertOwnership();
              remoteMutations += 1;
              return { outcome: 'succeeded' as const };
            },
          },
        ],
      ]),
    );

    await expect(leaseRunner.run(leaseOperationId)).resolves.toBeNull();
    expect(remoteMutations).toBe(1);
    const stillHeld = await infrastructure.database.dataSource.query<{ owner_token: string }[]>(
      `SELECT owner_token FROM "${infrastructure.database.schema}".integration_aggregate_lease
       WHERE lease_key = $1`,
      [`lead/${leaseOperationId}`],
    );
    expect(stillHeld).toHaveLength(1);
  });

  it('sends a retry the handler keeps asking for to the DLQ after the fifth attempt', async () => {
    const operationId = await createOperation();
    const service = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: () =>
              Promise.resolve({
                outcome: 'retry_wait' as const,
                nextAttemptAt: new Date(Date.now() + 1),
                errorCode: 'LEAD_SYNC_FAILED',
              }),
          },
        ],
      ]),
      new RetryPolicy({ baseDelayMs: 1, maxDelayMs: 1, random: () => 0 }),
    );
    const repository = infrastructure.database.dataSource.getRepository(OperationEntity);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await service.run(operationId);
      if (attempt < 5) {
        await repository.update({ id: operationId }, { nextAttemptAt: new Date(Date.now() - 1) });
      }
    }

    await expect(repository.findOneByOrFail({ id: operationId })).resolves.toMatchObject({
      status: 'dead_letter',
      attempt: 5,
      lastErrorCode: 'LEAD_SYNC_FAILED',
    });
    await expect(repository.existsBy({ operationKey: `dlq/${operationId}` })).resolves.toBe(true);
  });

  it('does not spend the attempt budget while an operation waits for a busy aggregate', async () => {
    const operationId = await createOperation();
    const service = runner(
      new Map([
        [
          'tiktok_ingest',
          {
            handle: () =>
              Promise.resolve({
                outcome: 'retry_wait' as const,
                nextAttemptAt: new Date(Date.now() + 1),
                errorCode: 'LEAD_SYNC_LEASE_BUSY',
                deferred: true as const,
              }),
          },
        ],
      ]),
    );
    const repository = infrastructure.database.dataSource.getRepository(OperationEntity);

    for (let round = 1; round <= 7; round += 1) {
      await service.run(operationId);
      await repository.update({ id: operationId }, { nextAttemptAt: new Date(Date.now() - 1) });
    }

    await expect(repository.findOneByOrFail({ id: operationId })).resolves.toMatchObject({
      status: 'retry_wait',
      attempt: 0,
      lastErrorCode: 'LEAD_SYNC_LEASE_BUSY',
    });
  });

  it('moves an expired worker lease to reconciliation without creating a fresh mutation job', async () => {
    const operationId = await createOperation(randomUUID(), 'bitrix_lead_sync');
    await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .update(
        { id: operationId },
        { status: 'processing', attempt: 1, leaseUntil: new Date(Date.now() - 1) },
      );
    const sweeper = new RecoverySweeperService(infrastructure.database.dataSource, outbox);

    await expect(sweeper.sweep()).resolves.toEqual({ redispatched: 0, reconciled: 1 });
    await expect(
      infrastructure.database.dataSource.getRepository(OperationEntity).findOneByOrFail({
        id: operationId,
      }),
    ).resolves.toMatchObject({ status: 'reconcile_required' });
  });

  it.each(['tiktok_ingest', 'integration_report', 'historical_lead_import'] as const)(
    'dispatches a %s operation again when its worker died, because replaying it is safe',
    async (kind) => {
      const operationId = await createOperation(randomUUID(), kind);
      const repository = infrastructure.database.dataSource.getRepository(OperationEntity);
      await repository.update(
        { id: operationId },
        { status: 'processing', attempt: 1, leaseUntil: new Date(Date.now() - 1) },
      );
      const sweeper = new RecoverySweeperService(infrastructure.database.dataSource, outbox);

      await expect(sweeper.sweep()).resolves.toEqual({ redispatched: 1, reconciled: 0 });
      await expect(repository.findOneByOrFail({ id: operationId })).resolves.toMatchObject({
        status: 'pending',
        attempt: 1,
        leaseUntil: null,
        lastErrorCode: 'WORKER_LEASE_EXPIRED',
      });
      await expect(
        infrastructure.database.dataSource
          .getRepository(OutboxEntity)
          .countBy({ operationId, publishedAt: IsNull() }),
      ).resolves.toBe(2);
    },
  );

  it('stops replaying an operation that keeps killing its worker', async () => {
    const operationId = await createOperation();
    const repository = infrastructure.database.dataSource.getRepository(OperationEntity);
    await repository.update(
      { id: operationId },
      { status: 'processing', attempt: 6, leaseUntil: new Date(Date.now() - 1) },
    );
    const sweeper = new RecoverySweeperService(infrastructure.database.dataSource, outbox);

    await expect(sweeper.sweep()).resolves.toEqual({ redispatched: 0, reconciled: 1 });
    await expect(repository.findOneByOrFail({ id: operationId })).resolves.toMatchObject({
      status: 'reconcile_required',
    });
  });

  it('recovers expired leases even behind a large backlog of waiting operations', async () => {
    const operationId = await createOperation();
    const repository = infrastructure.database.dataSource.getRepository(OperationEntity);
    await repository.update(
      { id: operationId },
      { status: 'processing', attempt: 1, leaseUntil: new Date(Date.now() - 1) },
    );
    const backlog = await Promise.all([createOperation(), createOperation(), createOperation()]);
    await repository.update(backlog, { updatedAt: new Date(Date.now() - 3_600_000) });
    const sweeper = new RecoverySweeperService(infrastructure.database.dataSource, outbox);

    await sweeper.sweep(2);

    await expect(repository.findOneByOrFail({ id: operationId })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('recreates a durable queue generation when a published Redis job has gone missing', async () => {
    const operationId = await createOperation();
    const firstOutbox = await infrastructure.database.dataSource
      .getRepository(OutboxEntity)
      .findOneByOrFail({ operationId });
    const old = new Date(Date.now() - 120_000);
    await infrastructure.database.dataSource
      .getRepository(OutboxEntity)
      .update({ id: firstOutbox.id }, { publishedAt: old, createdAt: old });
    const sweeper = new RecoverySweeperService(infrastructure.database.dataSource, outbox);

    await expect(sweeper.sweep()).resolves.toEqual({ redispatched: 1, reconciled: 0 });
    const generations = await infrastructure.database.dataSource
      .getRepository(OutboxEntity)
      .find({ where: { operationId }, order: { dispatchGeneration: 'ASC' } });
    expect(generations.map((entry) => entry.jobKey)).toEqual([
      `${operationId}-1`,
      `${operationId}-2`,
    ]);
  });

  it('boots and shuts down the isolated worker module against test PostgreSQL and Redis', async () => {
    process.env.TIKTOK_DATABASE_URL = process.env.TIKTOK_TEST_DATABASE_URL;
    process.env.TIKTOK_DATABASE_SCHEMA = infrastructure.database.schema;
    process.env.TIKTOK_REDIS_URL = process.env.TIKTOK_TEST_REDIS_URL;
    process.env.INTEGRATION_QUEUE_PREFIX = infrastructure.redisPrefix;
    const app = await NestFactory.createApplicationContext(TiktokWorkerModule, { logger: false });

    await expect(app.close()).resolves.toBeUndefined();
  });
});
