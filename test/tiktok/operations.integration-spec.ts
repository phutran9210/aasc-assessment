import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v7 as uuidv7 } from 'uuid';

import { TiktokHealthService } from '@/apps/tiktok/health/health.service.js';
import { IntegrationMetrics } from '@common/logging/integration-logger.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { RedisRateLimiter } from '@core/queue/services/rate-limiter.service.js';
import { WorkerHeartbeatService } from '@core/queue/services/worker-heartbeat.service.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { NotificationEntity } from '@modules/integration-reports/entities/notification.entity.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { NotificationRepository } from '@modules/integration-reports/repositories/notification.repository.js';
import { ReportJobRepository } from '@modules/integration-reports/repositories/report-job.repository.js';
import { ArtifactService } from '@modules/integration-reports/services/artifact.service.js';
import { NotificationService } from '@modules/integration-reports/services/notification.service.js';
import { RetentionService } from '@modules/integration-reports/services/retention.service.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const NOW = '2026-10-09T05:00:00.000Z';
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000);
const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000);

describe('operational safeguards', () => {
  let infrastructure: TestInfrastructure;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
  });

  afterAll(async () => {
    await infrastructure.close();
  });

  const repository = <T extends object>(entity: new () => T) =>
    infrastructure.database.dataSource.getRepository(entity);

  describe('Redis rate limiter', () => {
    it('shares one window between instances and reports the time to retry', async () => {
      const key = `probe:${randomUUID()}`;
      const first = new RedisRateLimiter(infrastructure.redis);
      const second = new RedisRateLimiter(infrastructure.redis);

      const results = [];
      for (let index = 0; index < 5; index += 1) {
        results.push(await (index % 2 ? second : first).consume(key, 3, 60_000));
      }

      expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
      expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0, 0]);
      expect(results[4].retryAfterMs).toBeGreaterThan(55_000);
      expect(results[4].retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it('opens a new window once the previous one expired', async () => {
      const key = `probe:${randomUUID()}`;
      const limiter = new RedisRateLimiter(infrastructure.redis);

      expect((await limiter.consume(key, 1, 150)).allowed).toBe(true);
      expect((await limiter.consume(key, 1, 150)).allowed).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 220));
      expect((await limiter.consume(key, 1, 150)).allowed).toBe(true);
    });

    it('throws when Redis cannot be reached so callers can choose their fallback', async () => {
      const offline = new RedisConnectionFactory('redis://127.0.0.1:1', 'offline');

      await expect(new RedisRateLimiter(offline).consume('k', 1, 1_000)).rejects.toBeDefined();
      await offline.closeAll();
    });
  });

  describe('readiness', () => {
    let clock = Date.parse(NOW);
    const config = { tiktokMode: 'mock' as const, bitrixMode: 'mock' as const };

    function health(options: { workerRequired?: boolean; redis?: RedisConnectionFactory } = {}) {
      const redis = options.redis ?? infrastructure.redis;
      return new TiktokHealthService(
        infrastructure.database.dataSource,
        redis,
        new WorkerHeartbeatService(redis, `reader-${randomUUID()}`, () => clock),
        new IntegrationMetrics(),
        { ...config, workerRequired: options.workerRequired ?? false },
        () => clock,
      );
    }

    beforeEach(() => {
      clock = Date.parse(NOW);
    });

    it('reports the process as live without touching any dependency', () => {
      expect(health().live()).toEqual({ status: 'ok' });
    });

    it('is ready when database, schema, Redis and configuration are healthy', async () => {
      const readiness = await health().ready();

      expect(readiness).toMatchObject({
        status: 'ok',
        checkedAt: NOW,
        checks: {
          database: 'ok',
          schema: 'ok',
          redis: 'ok',
          config: 'ok',
          worker: 'not_required',
        },
        providerMode: { tiktok: 'mock', bitrix: 'mock' },
      });
      expect(readiness.metrics).toEqual(
        expect.objectContaining({
          oldestPendingSeconds: expect.any(Number),
          deadLetters: expect.any(Number),
          reconcileRequired: expect.any(Number),
        }),
      );
    });

    it('treats a worker heartbeat older than 30 seconds as stale', async () => {
      const prefix = `heartbeat-${randomUUID()}`;
      const redis = new RedisConnectionFactory(process.env.TIKTOK_TEST_REDIS_URL ?? '', prefix);
      const worker = new WorkerHeartbeatService(redis, 'worker-1', () => clock);
      const service = health({ workerRequired: true, redis });

      expect((await service.ready()).checks.worker).toBe('down');

      await worker.beat();
      clock += 30_000;
      expect(await service.ready()).toMatchObject({ status: 'ok', checks: { worker: 'ok' } });

      clock += 1_000;
      expect(await service.ready()).toMatchObject({
        status: 'unavailable',
        checks: { worker: 'stale' },
      });

      await worker.beat();
      expect((await service.ready()).status).toBe('ok');
      await (await redis.shared()).del(`${prefix}:worker-heartbeats`);
      await redis.closeAll();
    });

    it('is unavailable when Redis is down, while the database check still passes', async () => {
      const offline = new RedisConnectionFactory('redis://127.0.0.1:1', 'offline');

      const readiness = await health({ redis: offline }).ready();

      expect(readiness).toMatchObject({
        status: 'unavailable',
        checks: { database: 'ok', redis: 'down' },
      });
      await offline.closeAll();
    });

    it('is unavailable when the database does not answer', async () => {
      const broken = {
        transaction: () => Promise.reject(new Error('connection refused')),
        showMigrations: () => Promise.reject(new Error('connection refused')),
      };
      const service = new TiktokHealthService(
        broken as never,
        infrastructure.redis,
        new WorkerHeartbeatService(infrastructure.redis, 'reader', () => clock),
        new IntegrationMetrics(),
        { ...config, workerRequired: false },
        () => clock,
      );

      const readiness = await service.ready();

      expect(readiness).toMatchObject({
        status: 'unavailable',
        checks: { database: 'down', schema: 'down', redis: 'ok' },
        metrics: null,
      });
    });

    it('publishes queue age and failure gauges with low-cardinality labels only', async () => {
      const metrics = new IntegrationMetrics();
      const service = new TiktokHealthService(
        infrastructure.database.dataSource,
        infrastructure.redis,
        new WorkerHeartbeatService(infrastructure.redis, 'reader', () => clock),
        metrics,
        { ...config, workerRequired: false },
        () => clock,
      );
      await repository(OperationEntity).save({
        id: uuidv7(),
        operationKey: `health-probe/${randomUUID()}`,
        kind: 'bitrix_lead_sync',
        status: 'pending',
        attempt: 0,
        payload: {},
        configRevisions: {},
        createdAt: new Date(clock - 90_000),
        updatedAt: new Date(clock - 90_000),
      });

      const readiness = await service.ready();

      expect(readiness.metrics?.oldestPendingSeconds).toBeGreaterThanOrEqual(90);
      expect(metrics.snapshot().map((series) => series.name)).toEqual(
        expect.arrayContaining([
          'integration_oldest_pending_seconds',
          'integration_dead_letter_operations',
          'integration_reconcile_required_operations',
        ]),
      );
      for (const series of metrics.snapshot()) {
        expect(
          Object.keys(series.labels).every((label) => ['check', 'status'].includes(label)),
        ).toBe(true);
      }
    });
  });

  describe('retention', () => {
    let root: string;
    let retention: RetentionService;
    let artifacts: ArtifactService;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'aasc-retention-'));
      const dataSource = infrastructure.database.dataSource;
      const notificationRows = new NotificationRepository(dataSource);
      artifacts = new ArtifactService(root, new ReportJobRepository(dataSource));
      retention = new RetentionService(
        dataSource,
        artifacts,
        new NotificationService(
          dataSource,
          notificationRows,
          new OperationRepository(),
          new OutboxRepository(),
        ),
      );
    });

    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    beforeEach(async () => {
      const schema = infrastructure.database.schema;
      await infrastructure.database.dataSource.query(
        `TRUNCATE ${[
          'integration_notification',
          'integration_report_job',
          'integration_submission',
          'integration_lead',
          'integration_webhook_event',
          'integration_audit_event',
          'integration_outbox',
          'integration_operation',
        ]
          .map((table) => `"${schema}"."${table}"`)
          .join(', ')} CASCADE`,
      );
      await rm(join(root, 'exports'), { recursive: true, force: true });
      await rm(join(root, 'imports'), { recursive: true, force: true });
      await rm(join(root, 'tmp'), { recursive: true, force: true });
    });

    async function saveEvent(status: string, receivedAt: Date): Promise<string> {
      const id = uuidv7();
      await repository(WebhookEventEntity).save({
        id,
        provider: 'tiktok',
        providerMode: 'mock',
        scopeKey: 'retention',
        advertiserId: 'retention',
        portalKey: null,
        eventKey: `event-${id}`,
        eventType: 'lead.generate',
        occurredAt: receivedAt,
        receivedAt,
        rawBody: Buffer.from('{"email":"person@example.test"}'),
        payload: { lead_data: { email: 'person@example.test' } },
        payloadHash: 'a'.repeat(64),
        status,
        errorCode: null,
      });
      return id;
    }

    async function saveJob(input: {
      kind?: ReportJobEntity['kind'];
      status?: string;
      expiresAt?: Date | null;
      updatedAt?: Date;
      area?: 'exports' | 'imports';
      withFile?: boolean;
    }): Promise<{ id: string; file: string }> {
      const id = uuidv7();
      const area = input.area ?? 'exports';
      const name = `${randomUUID()}.csv`;
      if (input.withFile !== false) {
        await mkdir(join(root, area, id), { recursive: true });
        await writeFile(join(root, area, id, name), 'data');
      }
      await repository(ReportJobEntity).save({
        id,
        kind: input.kind ?? 'export',
        requesterId: null,
        filters: {},
        status: input.status ?? 'completed',
        artifactPath: `${area}/${id}/${name}`,
        artifactHash: 'b'.repeat(64),
        expiresAt: input.expiresAt === undefined ? hoursAgo(1) : input.expiresAt,
        createdAt: input.updatedAt ?? hoursAgo(30),
        updatedAt: input.updatedAt ?? hoursAgo(30),
      });
      return { id, file: join(root, area, id, name) };
    }

    async function saveOperation(status: OperationEntity['status'], updatedAt: Date) {
      const id = uuidv7();
      await repository(OperationEntity).save({
        id,
        operationKey: `retention/${id}`,
        kind: 'bitrix_lead_sync',
        status,
        attempt: 1,
        payload: {},
        configRevisions: {},
        createdAt: updatedAt,
        updatedAt,
      });
      return id;
    }

    it('purges raw payloads after 30 days but keeps the dedup tombstone and open investigations', async () => {
      const old = await saveEvent('processed', daysAgo(31));
      const recent = await saveEvent('processed', daysAgo(29));
      const pending = await saveEvent('received', daysAgo(40));
      const quarantined = await saveEvent('quarantined', daysAgo(40));

      const summary = await retention.run(NOW);

      expect(summary.rawEventsPurged).toBe(1);
      const purged = await repository(WebhookEventEntity).findOneByOrFail({ id: old });
      expect(purged.rawBody.length).toBe(0);
      expect(purged.payload).toEqual({ purged: true });
      expect(purged).toMatchObject({ payloadHash: 'a'.repeat(64), eventKey: `event-${old}` });
      for (const id of [recent, pending, quarantined]) {
        const kept = await repository(WebhookEventEntity).findOneByOrFail({ id });
        expect(kept.rawBody.length).toBeGreaterThan(0);
      }
      expect((await retention.run(NOW)).rawEventsPurged).toBe(0);
    });

    it('deletes tombstones after 180 days unless a submission still refers to them', async () => {
      const unreferenced = await saveEvent('processed', daysAgo(181));
      const fixtures = analyticsFixtures(infrastructure.database.dataSource, 'retention');
      const leadId = await fixtures.saveLead({ firstTouchAt: daysAgo(181) });
      await fixtures.saveSubmission({ leadId, occurredAt: daysAgo(181) });
      const referenced = await repository(WebhookEventEntity).find({
        where: { eventType: 'lead.generate', scopeKey: 'analytics-scope' },
      });

      const summary = await retention.run(NOW);

      expect(summary.eventTombstonesDeleted).toBe(1);
      expect(await repository(WebhookEventEntity).findOneBy({ id: unreferenced })).toBeNull();
      expect(
        await repository(WebhookEventEntity).findOneBy({ id: referenced[0].id }),
      ).not.toBeNull();
    });

    it('removes export artifacts after 24 hours and keeps unexpired ones', async () => {
      const expired = await saveJob({ expiresAt: hoursAgo(1) });
      const fresh = await saveJob({ expiresAt: new Date(Date.parse(NOW) + 3_600_000) });

      const summary = await retention.run(NOW);

      expect(summary.artifactsExpired).toBe(1);
      expect(existsSync(expired.file)).toBe(false);
      expect(existsSync(fresh.file)).toBe(true);
      const stored = await new ReportJobRepository(infrastructure.database.dataSource).findById(
        expired.id,
      );
      expect(stored).toMatchObject({ status: 'expired', artifactPath: null });
    });

    it('does not follow a job directory that is a symlink out of the artifact root', async () => {
      const outside = await mkdtemp(join(tmpdir(), 'aasc-outside-'));
      await writeFile(join(outside, 'keep.txt'), 'must survive');
      const job = await saveJob({ expiresAt: hoursAgo(1), withFile: false });
      await mkdir(join(root, 'exports'), { recursive: true });
      await symlink(outside, join(root, 'exports', job.id));

      const summary = await retention.run(NOW);

      expect(summary.skippedArtifacts).toBe(1);
      expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
      await rm(outside, { recursive: true, force: true });
    });

    it('purges finished import uploads after 30 days and stale temporary files after a day', async () => {
      const oldImport = await saveJob({
        kind: 'import',
        area: 'imports',
        expiresAt: null,
        updatedAt: daysAgo(31),
      });
      const runningImport = await saveJob({
        kind: 'import',
        area: 'imports',
        status: 'running',
        expiresAt: null,
        updatedAt: daysAgo(31),
      });
      await mkdir(join(root, 'tmp'), { recursive: true });
      const stale = join(root, 'tmp', 'stale.part');
      const active = join(root, 'tmp', 'active.part');
      await writeFile(stale, 'x');
      await writeFile(active, 'x');
      await utimes(stale, hoursAgo(25), hoursAgo(25));
      await utimes(active, new Date(Date.parse(NOW)), new Date(Date.parse(NOW)));

      const summary = await retention.run(NOW);

      expect(summary).toMatchObject({ importFilesPurged: 1, tempFilesRemoved: 1 });
      expect(existsSync(oldImport.file)).toBe(false);
      expect(existsSync(runningImport.file)).toBe(true);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(active)).toBe(true);
    });

    it('deletes audit records and finished operations after 180 days, never pending or failed ones', async () => {
      const oldAudit = uuidv7();
      await repository(AuditEventEntity).save([
        {
          id: oldAudit,
          scopeKey: 'retention',
          actorId: null,
          eventType: 'old',
          aggregateType: null,
          aggregateId: null,
          metadata: {},
          createdAt: daysAgo(181),
          updatedAt: daysAgo(181),
        },
        {
          id: uuidv7(),
          scopeKey: 'retention',
          actorId: null,
          eventType: 'recent',
          aggregateType: null,
          aggregateId: null,
          metadata: {},
          createdAt: daysAgo(179),
          updatedAt: daysAgo(179),
        },
      ]);
      const done = await saveOperation('succeeded', daysAgo(181));
      const recent = await saveOperation('succeeded', daysAgo(179));
      const pending = await saveOperation('pending', daysAgo(400));
      const dead = await saveOperation('dead_letter', daysAgo(400));
      const reconcile = await saveOperation('reconcile_required', daysAgo(400));

      const summary = await retention.run(NOW);

      expect(summary).toMatchObject({ auditEventsDeleted: 1, operationsDeleted: 1 });
      expect(await repository(AuditEventEntity).count()).toBe(1);
      expect(await repository(OperationEntity).findOneBy({ id: done })).toBeNull();
      for (const id of [recent, pending, dead, reconcile]) {
        expect(await repository(OperationEntity).findOneBy({ id })).not.toBeNull();
      }
    });

    it('raises an alert when a retention step fails and still reports the failure', async () => {
      const failing = jest
        .spyOn(artifacts, 'sweepTemp')
        .mockRejectedValueOnce(new Error('disk unavailable'));

      await expect(retention.run(NOW)).rejects.toThrow('disk unavailable');
      failing.mockRestore();

      expect(await repository(NotificationEntity).find()).toEqual([
        expect.objectContaining({ type: 'alert.retention_failed' }),
      ]);
    });
  });
});
