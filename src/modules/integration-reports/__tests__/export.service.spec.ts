import { HttpException } from '@nestjs/common';

import { ExportService, toReportJobDto } from '../services/export.service.js';
import type { ExportServiceOptions } from '../services/export.service.js';

function setup(options: ExportServiceOptions = {}) {
  const job = {
    id: 'job-1',
    kind: 'export',
    status: 'pending',
    filters: {
      format: 'csv',
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-09T00:00:00Z',
      timezone: 'Asia/Ho_Chi_Minh',
      campaignId: null,
      providerMode: { tiktok: 'mock', bitrix: 'mock' },
    },
  };
  const dataSource = {
    transaction: jest.fn(async (run: (manager: unknown) => Promise<unknown>) => run({})),
  };
  const exports = {
    snapshot: jest.fn().mockRejectedValue(new Error('database unavailable')),
    count: jest.fn().mockResolvedValue(0),
  };
  const jobs = {
    findById: jest.fn().mockResolvedValue(job),
    update: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  const artifacts = {
    purgeJob: jest.fn().mockResolvedValue(undefined),
    createTemp: jest.fn().mockResolvedValue('/tmp/export-test.csv'),
    discard: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn().mockResolvedValue({ path: '/tmp/job-1.csv', hash: 'sha256' }),
  };
  const notifications = { ensure: jest.fn().mockResolvedValue(undefined) };
  const context = { attempt: 1, assertOwnership: jest.fn().mockResolvedValue(undefined) };
  const scope = {
    advertiserId: 'advertiser-1',
    tiktokMode: 'mock',
    bitrixMode: 'mock',
    reportTimezone: 'Asia/Ho_Chi_Minh',
  };
  const service = new ExportService(
    dataSource as never,
    exports as never,
    jobs as never,
    artifacts as never,
    {} as never,
    {} as never,
    scope as never,
    options,
    notifications,
  );
  return { service, job, dataSource, exports, jobs, artifacts, notifications, context };
}

describe('ExportService worker outcomes', () => {
  it('quarantines a missing or unrelated report job', async () => {
    const { service, jobs, job, context } = setup();
    jobs.findById.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...job, kind: 'import' });

    await expect(service.execute('missing', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
  });

  it('returns immediately for completed or failed jobs', async () => {
    const { service, jobs, job, artifacts, context } = setup();
    jobs.findById
      .mockResolvedValueOnce({ ...job, status: 'completed' })
      .mockResolvedValueOnce({ ...job, status: 'failed' });

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_FAILED',
    });
    expect(artifacts.createTemp).not.toHaveBeenCalled();
  });

  it('closes a job abandoned after the allowed worker attempts', async () => {
    const { service, jobs, artifacts, context } = setup();
    context.attempt = 6;

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'REPORT_WORKER_ABANDONED',
    });
    expect(artifacts.purgeJob).toHaveBeenCalledWith('job-1');
    expect(jobs.update).toHaveBeenCalledWith('job-1', {
      status: 'failed',
      errorSummary: 'REPORT_WORKER_ABANDONED',
    });
  });

  it('retries a transient export error from a fresh temporary artifact', async () => {
    const { service, jobs, artifacts, context } = setup();

    await expect(service.execute('job-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'EXPORT_FAILED',
    });
    expect(artifacts.discard).toHaveBeenCalledWith('/tmp/export-test.csv');
    expect(jobs.update).toHaveBeenCalledWith('job-1', {
      status: 'pending',
      errorSummary: 'EXPORT_FAILED',
    });
  });

  it('dead-letters an overlarge export without scheduling another attempt', async () => {
    const { service, exports, jobs, context } = setup();
    exports.snapshot.mockRejectedValueOnce(new HttpException({ code: 'EXPORT_TOO_LARGE' }, 422));

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'EXPORT_TOO_LARGE',
    });
    expect(jobs.update).toHaveBeenCalledWith('job-1', {
      status: 'failed',
      errorSummary: 'EXPORT_TOO_LARGE',
    });
  });

  it('dead-letters a repeated transient error on the last attempt', async () => {
    const { service, jobs, context } = setup();
    context.attempt = 5;

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'EXPORT_FAILED',
    });
    expect(jobs.update).toHaveBeenCalledWith('job-1', {
      status: 'failed',
      errorSummary: 'EXPORT_FAILED',
    });
  });

  it('completes an export after the artifact is finalized', async () => {
    const { service, exports, jobs, artifacts, notifications, context } = setup();
    const snapshotAt = new Date('2026-10-09T01:00:00.000Z');
    exports.snapshot.mockResolvedValueOnce({ rowCount: 2, snapshotAt });

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(artifacts.finalize).toHaveBeenCalledWith('/tmp/export-test.csv', 'job-1');
    expect(jobs.complete).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        artifactPath: '/tmp/job-1.csv',
        artifactHash: 'sha256',
        totalRows: 2,
        snapshotAt,
      }),
      expect.anything(),
    );
    expect(notifications.ensure).not.toHaveBeenCalled();
    expect(context.assertOwnership).toHaveBeenCalledTimes(2);
  });

  it('announces a completed scheduled report in the completion transaction', async () => {
    const { service, job, exports, jobs, notifications, context } = setup();
    jobs.findById.mockResolvedValueOnce({
      ...job,
      kind: 'scheduled',
      filters: { ...job.filters, reportType: 'leads', period: 'daily' },
    });
    exports.snapshot.mockResolvedValueOnce({
      rowCount: 3,
      snapshotAt: new Date('2026-10-09T01:00:00.000Z'),
    });

    await expect(service.execute('job-1', context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(notifications.ensure).toHaveBeenCalledWith(
      {
        dedupKey: 'report-ready/job-1',
        type: 'report.ready',
        payload: {
          jobId: 'job-1',
          reportType: 'leads',
          period: 'daily',
          rows: 3,
          link: '/api/v1/reports/jobs/job-1/download',
        },
      },
      expect.anything(),
    );
  });

  it('uses configured export limits before queuing an oversized export', async () => {
    const { service, exports, dataSource } = setup({
      syncLimit: 2,
      asyncLimit: 3,
      pageSize: 4,
      clock: () => '2026-10-09T00:00:00.000Z',
    });
    exports.count.mockResolvedValueOnce(4);

    await expect(
      service.schedule({ format: 'csv', from: '2026-10-01', to: '2026-10-09' }, {
        sub: 'user-1',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_TOO_LARGE' } });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('falls back to CSV for a stored job with an unsupported format', async () => {
    const { service, job, jobs, artifacts, context } = setup();
    jobs.findById.mockResolvedValueOnce({ ...job, filters: { ...job.filters, format: 'legacy' } });

    await expect(service.execute('job-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
    });
    expect(artifacts.createTemp).toHaveBeenCalledWith('csv');
  });

  it('classifies an HTTP error without an export code as a retryable failure', async () => {
    const { service, exports, context } = setup();
    exports.snapshot.mockRejectedValueOnce(new HttpException('upstream unavailable', 503));

    await expect(service.execute('job-1', context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'EXPORT_FAILED',
    });
  });

  it('returns nullable job metadata when the stored format is absent', () => {
    const createdAt = new Date('2026-10-08T00:00:00.000Z');
    const updatedAt = new Date('2026-10-09T00:00:00.000Z');
    const dto = toReportJobDto({
      id: 'job-1',
      kind: 'export',
      status: 'pending',
      filters: {},
      snapshotAt: null,
      expiresAt: null,
      totalRows: 0,
      successRows: 0,
      failedRows: 0,
      errorSummary: null,
      createdAt,
      updatedAt,
    } as never);

    expect(dto).toMatchObject({
      format: null,
      snapshotAt: null,
      expiresAt: null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  });
});
