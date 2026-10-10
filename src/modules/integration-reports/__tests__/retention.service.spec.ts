import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { NotificationEntity } from '../entities/notification.entity.js';
import { ReportJobEntity } from '../entities/report-job.entity.js';
import { RetentionService } from '../services/retention.service.js';

describe('RetentionService', () => {
  function setup() {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: undefined }),
      getQuery: jest.fn().mockReturnValue('SELECT operation_id FROM ledger'),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const reportJobs = { createQueryBuilder: jest.fn(() => qb), update: jest.fn() };
    const operations = { createQueryBuilder: jest.fn(() => qb), delete: jest.fn() };
    const outbox = { delete: jest.fn() };
    const audits = { delete: jest.fn().mockResolvedValue({ affected: undefined }) };
    const notificationsRepo = { delete: jest.fn().mockResolvedValue({ affected: 2 }) };
    const manager = {
      createQueryBuilder: jest.fn(() => qb),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === ReportJobEntity) return reportJobs;
        if (entity === OperationEntity) return operations;
        if (entity === OutboxEntity) return outbox;
        if (entity === AuditEventEntity) return audits;
        if (entity === NotificationEntity) return notificationsRepo;
        throw new Error('unexpected entity');
      }),
    };
    const dataSource = {
      manager,
      getRepository: manager.getRepository,
      transaction: jest.fn((run: (tx: typeof manager) => Promise<unknown>) => run(manager)),
    };
    const artifacts = {
      removeJobDirectory: jest.fn().mockResolvedValue('removed'),
      sweepTemp: jest.fn().mockResolvedValue(3),
    };
    const notifications = { ensure: jest.fn() };
    return {
      service: new RetentionService(
        dataSource as never,
        artifacts as never,
        notifications as never,
      ),
      qb,
      reportJobs,
      operations,
      outbox,
      audits,
      notificationsRepo,
      dataSource,
      manager,
      artifacts,
      notifications,
    };
  }

  it('purges eligible payloads, releases artifacts, keeps skipped files, and deletes unreferenced batches', async () => {
    const {
      service,
      qb,
      reportJobs,
      operations,
      outbox,
      audits,
      notificationsRepo,
      artifacts,
      manager,
    } = setup();
    qb.execute
      .mockResolvedValueOnce({ affected: 4 })
      .mockResolvedValueOnce({ affected: 2 })
      .mockResolvedValueOnce({ affected: 1 });
    qb.getMany
      .mockResolvedValueOnce([{ id: 'export-1' }, { id: 'export-2' }])
      .mockResolvedValueOnce([{ id: 'import-1' }]);
    artifacts.removeJobDirectory
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('removed')
      .mockResolvedValueOnce('removed');
    qb.getRawMany.mockResolvedValueOnce([{ id: 'op-1' }, { id: 'op-2' }]).mockResolvedValueOnce([]);

    await expect(service.run('2026-10-10T00:00:00.000Z')).resolves.toEqual({
      rawEventsPurged: 4,
      eventTombstonesDeleted: 2,
      artifactsExpired: 1,
      importFilesPurged: 1,
      tempFilesRemoved: 3,
      skippedArtifacts: 1,
      auditEventsDeleted: 0,
      operationsDeleted: 2,
      notificationsDeleted: 2,
      reportJobsDeleted: 1,
    });
    expect(artifacts.removeJobDirectory).toHaveBeenNthCalledWith(1, 'export-1', 'exports');
    expect(reportJobs.update).toHaveBeenCalledWith('export-2', {
      artifactPath: null,
      status: 'expired',
    });
    expect(reportJobs.update).toHaveBeenCalledWith('import-1', { artifactPath: null });
    expect(outbox.delete).toHaveBeenCalledTimes(1);
    expect(operations.delete).toHaveBeenCalledTimes(1);
    expect(manager.createQueryBuilder).toHaveBeenCalledWith();
    expect(audits.delete).toHaveBeenCalled();
    expect(notificationsRepo.delete).toHaveBeenCalled();
  });

  it('reports retention failures once and rethrows the original error', async () => {
    const { service, artifacts, notifications, dataSource } = setup();
    const failure = new Error('disk unavailable');
    artifacts.sweepTemp.mockRejectedValueOnce(failure);
    await expect(service.run('2026-10-10T23:00:00.000Z')).rejects.toBe(failure);
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(notifications.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'alert/retention_failed/2026-10-10',
        type: 'alert.retention_failed',
        payload: { failedAt: '2026-10-10T23:00:00.000Z', error: 'Error' },
      }),
      expect.anything(),
    );
  });

  it('labels non-Error failures when recording the failure notice', async () => {
    const { service, artifacts, notifications } = setup();
    artifacts.sweepTemp.mockRejectedValueOnce('unknown');
    await expect(service.run('2026-10-10T00:00:00.000Z')).rejects.toBe('unknown');
    expect(notifications.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ error: 'UnknownError' }) }),
      expect.anything(),
    );
  });
});
