import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { NotificationEntity } from '@modules/integration-reports/entities/notification.entity.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { ExportRepository } from '@modules/integration-reports/repositories/export.repository.js';
import { NotificationRepository } from '@modules/integration-reports/repositories/notification.repository.js';
import { ReportJobRepository } from '@modules/integration-reports/repositories/report-job.repository.js';
import { AlertService } from '@modules/integration-reports/services/alert.service.js';
import { ArtifactService } from '@modules/integration-reports/services/artifact.service.js';
import { ExportService } from '@modules/integration-reports/services/export.service.js';
import {
  ConversionNotificationListener,
  NotificationService,
} from '@modules/integration-reports/services/notification.service.js';
import type { BitrixNotifier } from '@modules/integration-reports/services/notification.service.js';
import { ReportScheduler } from '@modules/integration-reports/services/report-scheduler.service.js';
import { NotificationHandler } from '@modules/integration-reports/workers/notification.handler.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const ADVERTISER = 'advertiser-scheduler';
// A fake clock far from the real one: rows written with database defaults never fall in a window.
const NOW = '2026-03-15T03:00:00.000Z';
const at = (minutesAgo: number) => new Date(Date.parse(NOW) - minutesAgo * 60_000);
const later = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

function context(operationId: string = randomUUID(), attempt = 1): OperationContext {
  return {
    operationId,
    ownerToken: randomUUID(),
    attempt,
    revisions: {},
    signal: new AbortController().signal,
    assertOwnership: () => Promise.resolve(),
    acquireAggregateLease: () => Promise.resolve(null),
    releaseAggregateLease: () => Promise.resolve(true),
  };
}

const actor = (role: Actor['roles'][number]): Actor => ({
  sub: randomUUID(),
  sid: randomUUID(),
  username: role,
  roles: [role],
});

describe('scheduled reports, notifications and alerts', () => {
  let infrastructure: TestInfrastructure;
  let root: string;
  let notifications: NotificationService;
  let notificationRepository: NotificationRepository;
  let alerts: AlertService;
  let artifacts: ArtifactService;
  let exporter: ExportService;
  const scope = {
    advertiserId: ADVERTISER,
    tiktokMode: 'mock' as const,
    bitrixMode: 'mock' as const,
    reportTimezone: 'Asia/Ho_Chi_Minh',
  };

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    root = await mkdtemp(join(tmpdir(), 'aasc-scheduler-'));
    const dataSource = infrastructure.database.dataSource;
    notificationRepository = new NotificationRepository(dataSource);
    notifications = new NotificationService(
      dataSource,
      notificationRepository,
      new OperationRepository(),
      new OutboxRepository(),
    );
    alerts = new AlertService(dataSource, notifications, notificationRepository, {
      advertiserId: ADVERTISER,
    });
    const jobs = new ReportJobRepository(dataSource);
    artifacts = new ArtifactService(root, jobs);
    exporter = new ExportService(
      dataSource,
      new ExportRepository(dataSource),
      jobs,
      artifacts,
      new OperationRepository(),
      new OutboxRepository(),
      scope,
      {},
      notifications,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await infrastructure.close();
  });

  beforeEach(async () => {
    const schema = infrastructure.database.schema;
    await infrastructure.database.dataSource.query(
      `TRUNCATE ${[
        'integration_notification',
        'integration_report_job',
        'integration_lead',
        'integration_outbox',
        'integration_operation',
      ]
        .map((table) => `"${schema}"."${table}"`)
        .join(', ')} CASCADE`,
    );
    jest.restoreAllMocks();
  });

  function scheduler(): ReportScheduler {
    const dataSource = infrastructure.database.dataSource;
    return new ReportScheduler(
      dataSource,
      new ReportJobRepository(dataSource),
      new OperationRepository(),
      new OutboxRepository(),
      new ConfigurationRepository(dataSource),
      scope,
    );
  }

  const repository = <T extends object>(entity: new () => T) =>
    infrastructure.database.dataSource.getRepository(entity);
  const alertNotifications = async () =>
    (await repository(NotificationEntity).find({ order: { id: 'ASC' } }))
      .filter((notification) => notification.type.startsWith('alert.'))
      .map((notification) => notification.type);

  async function saveOperation(input: {
    status: OperationEntity['status'];
    kind?: OperationEntity['kind'];
    createdAt?: Date;
    updatedAt?: Date;
    lastErrorCode?: string | null;
  }): Promise<string> {
    const id = uuidv7();
    await repository(OperationEntity).save({
      id,
      operationKey: `probe/${id}`,
      kind: input.kind ?? 'bitrix_lead_sync',
      status: input.status,
      attempt: 1,
      payload: {},
      configRevisions: {},
      lastErrorCode: input.lastErrorCode ?? null,
      createdAt: input.createdAt ?? at(1),
      updatedAt: input.updatedAt ?? at(1),
    });
    return id;
  }

  describe('daily report schedule', () => {
    it('creates one job for the previous day when two schedulers tick together', async () => {
      // 01:00Z is exactly 08:00 in Asia/Ho_Chi_Minh on 2026-03-15.
      const results = await Promise.all([
        scheduler().tick('2026-03-15T01:00:00.000Z'),
        scheduler().tick('2026-03-15T01:00:00.000Z'),
        scheduler().tick('2026-03-15T01:00:05.000Z'),
      ]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
      expect(results[0]).toMatchObject({ reportType: 'daily-leads', period: '2026-03-14' });
      const [job] = await repository(ReportJobEntity).find();
      expect(await repository(ReportJobEntity).count()).toBe(1);
      expect(job).toMatchObject({
        kind: 'scheduled',
        requesterId: null,
        status: 'pending',
        filters: expect.objectContaining({
          reportType: 'daily-leads',
          period: '2026-03-14',
          from: '2026-03-13T17:00:00.000Z',
          to: '2026-03-14T17:00:00.000Z',
          timezone: 'Asia/Ho_Chi_Minh',
          format: 'csv',
        }),
      });
      const [operation] = await repository(OperationEntity).find();
      expect(operation).toMatchObject({
        operationKey: 'scheduled-report/0/daily-leads/2026-03-14',
        kind: 'integration_report',
        aggregateId: job.id,
      });
      expect(await repository(OutboxEntity).count()).toBe(1);
    });

    it('waits for 08:00 local time before reporting the day that just ended', async () => {
      const before = await scheduler().tick('2026-03-15T00:59:59.000Z');
      const again = await scheduler().tick('2026-03-15T00:59:59.500Z');
      const after = await scheduler().tick('2026-03-15T01:00:00.000Z');

      expect(before).toMatchObject({ period: '2026-03-13', created: true });
      expect(again).toMatchObject({ period: '2026-03-13', created: false });
      expect(after).toMatchObject({ period: '2026-03-14', created: true });
    });

    it('catches up a missed tick exactly once, for the latest due day only', async () => {
      const late = await scheduler().tick('2026-03-18T09:30:00.000Z');
      const repeat = await scheduler().tick('2026-03-18T09:31:00.000Z');

      expect(late).toMatchObject({ period: '2026-03-17', created: true });
      expect(repeat).toMatchObject({ period: '2026-03-17', created: false, jobId: late.jobId });
      expect(await repository(ReportJobEntity).count()).toBe(1);
    });

    it('exports the scheduled report and notifies operators once with a job link', async () => {
      const fixtures = analyticsFixtures(infrastructure.database.dataSource, ADVERTISER);
      const inside = await fixtures.saveLead({ firstTouchAt: new Date('2026-03-14T05:00:00Z') });
      await fixtures.saveLead({ firstTouchAt: new Date('2026-03-15T05:00:00Z') });
      const { jobId } = await scheduler().tick('2026-03-15T01:00:00.000Z');

      expect(await exporter.execute(jobId as string, context())).toEqual({ outcome: 'succeeded' });
      expect(await exporter.execute(jobId as string, context())).toEqual({ outcome: 'succeeded' });

      expect(
        await repository(ReportJobEntity).findOneByOrFail({ id: jobId as string }),
      ).toMatchObject({ status: 'completed', totalRows: 1 });
      const reports = await repository(NotificationEntity).find({
        where: { type: 'report.ready' },
      });
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        recipientId: null,
        payload: expect.objectContaining({
          audience: ['integration_operator', 'integration_admin'],
          jobId,
          period: '2026-03-14',
          link: `/api/v1/reports/jobs/${jobId}/download`,
        }),
      });

      const chunks: Buffer[] = [];
      const download = await artifacts.openAuthorized(
        jobId as string,
        actor('integration_operator'),
      );
      for await (const chunk of download.stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString('utf8')).toContain(inside);
      await expect(
        artifacts.openAuthorized(jobId as string, actor('integration_analyst')),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('notifications', () => {
    it('stores one notification per dedup key and queues a single delivery', async () => {
      const dataSource = infrastructure.database.dataSource;
      const input = {
        dedupKey: 'demo/1',
        type: 'demo.created',
        audience: ['integration_operator' as const],
        payload: { jobId: 'j-1' },
      };

      const ids = await Promise.all(
        Array.from({ length: 5 }, () =>
          dataSource.transaction((tx) => notifications.ensure(input, tx)),
        ),
      );

      expect(new Set(ids).size).toBe(1);
      expect(await repository(NotificationEntity).count()).toBe(1);
      const operations = await repository(OperationEntity).find();
      expect(operations).toEqual([
        expect.objectContaining({
          operationKey: `notification/${ids[0]}`,
          kind: 'integration_notification',
          payload: { notificationId: ids[0] },
        }),
      ]);
    });

    it('delivers through the operational log and the optional Bitrix channel', async () => {
      const dataSource = infrastructure.database.dataSource;
      const sent: unknown[] = [];
      const notifier: BitrixNotifier = {
        isEnabled: () => Promise.resolve(true),
        notify: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      };
      const withBitrix = new NotificationService(
        dataSource,
        notificationRepository,
        new OperationRepository(),
        new OutboxRepository(),
        notifier,
      );
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const id = await dataSource.transaction((tx) =>
        withBitrix.ensure(
          {
            dedupKey: 'demo/2',
            type: 'report.ready',
            audience: ['integration_operator'],
            channels: ['in_app', 'operational_log', 'bitrix'],
            payload: { jobId: 'j-2' },
          },
          tx,
        ),
      );
      const [operation] = await repository(OperationEntity).find();
      const handler = new NotificationHandler(dataSource, withBitrix);

      expect(await handler.handle(context(operation.id))).toEqual({ outcome: 'succeeded' });
      expect(await handler.handle(context(operation.id))).toEqual({ outcome: 'succeeded' });

      const lines = log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes(id));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        event: 'integration.notification',
        notificationId: id,
        type: 'report.ready',
      });
      expect(sent).toEqual([expect.objectContaining({ type: 'report.ready' })]);
      expect(await repository(NotificationEntity).findOneByOrFail({ id })).toMatchObject({
        status: 'sent',
        sentAt: expect.any(Date),
      });
    });

    it('retries a failed Bitrix delivery without touching the in-app notification', async () => {
      const dataSource = infrastructure.database.dataSource;
      const failing = new NotificationService(
        dataSource,
        notificationRepository,
        new OperationRepository(),
        new OutboxRepository(),
        { isEnabled: () => Promise.resolve(true), notify: () => Promise.reject(new Error('403')) },
      );
      const id = await dataSource.transaction((tx) =>
        failing.ensure(
          { dedupKey: 'demo/3', type: 'demo', channels: ['in_app', 'bitrix'], payload: {} },
          tx,
        ),
      );
      const [operation] = await repository(OperationEntity).find();
      const handler = new NotificationHandler(dataSource, failing);

      expect(await handler.handle(context(operation.id))).toMatchObject({
        outcome: 'retry_wait',
        errorCode: 'NOTIFICATION_DELIVERY_FAILED',
      });
      expect(await handler.handle(context(operation.id, 5))).toMatchObject({
        outcome: 'dead_letter',
      });
      expect(await repository(NotificationEntity).findOneByOrFail({ id })).toMatchObject({
        status: 'pending',
      });
    });

    it('skips Bitrix when the portal does not grant the notification scope', async () => {
      const dataSource = infrastructure.database.dataSource;
      const notify = jest.fn();
      const service = new NotificationService(
        dataSource,
        notificationRepository,
        new OperationRepository(),
        new OutboxRepository(),
        { isEnabled: () => Promise.resolve(false), notify },
      );
      await dataSource.transaction((tx) =>
        service.ensure({ dedupKey: 'demo/4', type: 'demo', channels: ['bitrix'], payload: {} }, tx),
      );
      const [operation] = await repository(OperationEntity).find();

      expect(
        await new NotificationHandler(dataSource, service).handle(context(operation.id)),
      ).toEqual({ outcome: 'succeeded' });
      expect(notify).not.toHaveBeenCalled();
    });

    it('turns a dead-letter notification operation into an operator notification', async () => {
      const dataSource = infrastructure.database.dataSource;
      const failedId = await saveOperation({ status: 'dead_letter', lastErrorCode: 'CRM_DOWN' });
      const operationId = uuidv7();
      await repository(OperationEntity).save({
        id: operationId,
        operationKey: `dlq-notification/${failedId}`,
        kind: 'integration_notification',
        status: 'processing',
        attempt: 1,
        payload: { sourceOperationId: failedId, errorCode: 'CRM_DOWN' },
        configRevisions: {},
      });
      const dlqId = uuidv7();
      await repository(OperationEntity).save({
        id: dlqId,
        operationKey: `dlq/${failedId}`,
        kind: 'integration_dlq',
        status: 'processing',
        attempt: 1,
        payload: { sourceOperationId: failedId },
        configRevisions: {},
      });
      const handler = new NotificationHandler(dataSource, notifications);

      expect(await handler.handle(context(operationId))).toEqual({ outcome: 'succeeded' });
      expect(await handler.handle(context(operationId))).toEqual({ outcome: 'succeeded' });
      expect(await handler.handle(context(dlqId))).toEqual({ outcome: 'succeeded' });
      expect(await handler.handle(context())).toMatchObject({ outcome: 'quarantined' });

      expect(await repository(NotificationEntity).find()).toEqual([
        expect.objectContaining({
          type: 'operation.dead_letter',
          dedupKey: `dead-letter/${failedId}`,
          status: 'sent',
          payload: expect.objectContaining({ operationId: failedId, errorCode: 'CRM_DOWN' }),
        }),
      ]);
    });

    it('records conversion milestones once while still scheduling feedback', async () => {
      const dataSource = infrastructure.database.dataSource;
      const scheduled: string[] = [];
      const listener = new ConversionNotificationListener(notifications, {
        schedule: (leadId, milestone) => {
          scheduled.push(`${leadId}/${milestone}`);
          return Promise.resolve();
        },
      });
      const leadId = randomUUID();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await dataSource.transaction((tx) => listener.schedule(leadId, 'deal_created', tx));
      }
      await dataSource.transaction((tx) => listener.schedule(leadId, 'lead_qualified', tx));

      expect(scheduled).toEqual([
        `${leadId}/deal_created`,
        `${leadId}/deal_created`,
        `${leadId}/lead_qualified`,
      ]);
      expect(
        (await repository(NotificationEntity).find()).map((notification) => notification.type),
      ).toEqual(['conversion.deal_created']);
    });

    it('lists a user their own notifications and those addressed to their role', async () => {
      const dataSource = infrastructure.database.dataSource;
      const operator = actor('integration_operator');
      const analyst = actor('integration_analyst');
      await dataSource.transaction(async (tx) => {
        await notifications.ensure(
          { dedupKey: 'list/1', type: 'a', audience: ['integration_operator'], payload: {} },
          tx,
        );
        await notifications.ensure(
          { dedupKey: 'list/2', type: 'b', recipientId: analyst.sub, payload: {} },
          tx,
        );
        await notifications.ensure(
          { dedupKey: 'list/3', type: 'c', audience: ['integration_admin'], payload: {} },
          tx,
        );
      });

      expect((await notifications.list(operator, 1, 20)).items.map((item) => item.type)).toEqual([
        'a',
      ]);
      expect((await notifications.list(analyst, 1, 20)).items.map((item) => item.type)).toEqual([
        'b',
      ]);
      expect((await notifications.list(actor('integration_admin'), 1, 20)).total).toBe(1);
    });
  });

  describe('alerts', () => {
    it('raises one dead-letter alert per 30 minute window and one recovery', async () => {
      const failed = await saveOperation({ status: 'dead_letter', updatedAt: at(2) });

      expect(await alerts.evaluate(NOW)).toMatchObject({ fired: ['dead_letter'], recovered: [] });
      expect(await alerts.evaluate(later(10))).toMatchObject({
        fired: [],
        active: ['dead_letter'],
      });
      expect(await alerts.evaluate(later(31))).toMatchObject({ fired: ['dead_letter'] });
      expect(await alertNotifications()).toEqual(['alert.dead_letter', 'alert.dead_letter']);

      await repository(OperationEntity).update(failed, { status: 'succeeded' });
      expect(await alerts.evaluate(later(40))).toMatchObject({
        fired: [],
        recovered: ['dead_letter'],
        active: [],
      });
      expect(await alerts.evaluate(later(41))).toMatchObject({ fired: [], recovered: [] });
      expect(await alertNotifications()).toEqual([
        'alert.dead_letter',
        'alert.dead_letter',
        'alert.dead_letter.recovered',
      ]);
    });

    it('alerts when the oldest pending operation waited more than five minutes', async () => {
      await saveOperation({ status: 'pending', createdAt: at(4) });
      expect((await alerts.evaluate(NOW)).active).toEqual([]);

      await saveOperation({ status: 'pending', createdAt: at(6) });
      const summary = await alerts.evaluate(NOW);

      expect(summary.fired).toEqual(['pending_backlog']);
      const [notification] = await repository(NotificationEntity).find();
      expect(notification.payload).toMatchObject({
        audience: ['integration_operator', 'integration_admin'],
        oldestPendingAt: at(6).toISOString(),
      });
    });

    it('ignores housekeeping operations when measuring the backlog', async () => {
      await saveOperation({
        status: 'pending',
        kind: 'integration_notification',
        createdAt: at(60),
      });
      await saveOperation({ status: 'succeeded', createdAt: at(60) });

      expect((await alerts.evaluate(NOW)).active).toEqual([]);
    });

    it('alerts on an upstream authentication failure in the last 15 minutes', async () => {
      await saveOperation({
        status: 'retry_wait',
        lastErrorCode: 'BITRIX_AUTH_EXPIRED',
        updatedAt: at(20),
      });
      expect((await alerts.evaluate(NOW)).active).toEqual([]);

      await saveOperation({
        status: 'retry_wait',
        lastErrorCode: 'BITRIX_TOKEN_REVOKED',
        updatedAt: at(3),
      });
      expect((await alerts.evaluate(NOW)).fired).toEqual(['upstream_auth']);
    });

    it.each([
      ['fires above 5% with at least 20 operations', 18, 2, ['failure_rate']],
      ['stays quiet at exactly 5%', 19, 1, []],
      ['stays quiet below 20 operations', 14, 5, []],
    ])('%s', async (_name, succeeded, failed, expected) => {
      for (let index = 0; index < succeeded; index += 1) {
        await saveOperation({ status: 'succeeded', updatedAt: at(5) });
      }
      for (let index = 0; index < failed; index += 1) {
        await saveOperation({ status: 'quarantined', updatedAt: at(5), lastErrorCode: 'BAD_ROW' });
      }
      for (let index = 0; index < 30; index += 1) {
        await saveOperation({ status: 'quarantined', updatedAt: at(16) });
      }

      const summary = await alerts.evaluate(NOW);

      expect(summary.active.filter((type) => type === 'failure_rate')).toEqual(expected);
    });

    it('stores one alert when two evaluators run at the same time', async () => {
      await saveOperation({ status: 'dead_letter', updatedAt: at(2) });

      const summaries = await Promise.all([alerts.evaluate(NOW), alerts.evaluate(NOW)]);

      expect(summaries.flatMap((summary) => summary.fired)).toEqual(['dead_letter']);
      expect(await alertNotifications()).toEqual(['alert.dead_letter']);
    });
  });
});
