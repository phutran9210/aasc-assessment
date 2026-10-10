import { HttpException } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-09T00:00:00.000Z'),
    snapshotAt: null,
    expiresAt: null,
    totalRows: 0,
    successRows: 0,
    failedRows: 0,
    errorSummary: null,
  };
  const dataSource = {
    transaction: jest.fn((run: (manager: unknown) => Promise<unknown>) => run({})),
  };
  const exports = {
    snapshot: jest.fn().mockRejectedValue(new Error('database unavailable')),
    count: jest.fn().mockResolvedValue(0),
    page: jest.fn().mockResolvedValue([]),
  };
  const jobs = {
    findById: jest.fn().mockResolvedValue(job),
    update: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    lockRequester: jest.fn().mockResolvedValue(undefined),
    countActive: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(job),
  };
  const artifacts = {
    purgeJob: jest.fn().mockResolvedValue(undefined),
    createTemp: jest.fn().mockResolvedValue('/tmp/export-test.csv'),
    discard: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn().mockResolvedValue({ path: '/tmp/job-1.csv', hash: 'sha256' }),
    openTemp: jest.fn().mockResolvedValue({ stream: {}, size: 12 }),
  };
  const notifications = { ensure: jest.fn().mockResolvedValue(undefined) };
  const operations = { ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
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
    operations as never,
    outbox as never,
    scope as never,
    options,
    notifications,
  );
  return {
    service,
    job,
    dataSource,
    exports,
    jobs,
    artifacts,
    notifications,
    context,
    operations,
    outbox,
  };
}

describe('ExportService worker outcomes', () => {
  it('streams all pages into a synchronous export and removes the temporary file after opening it', async () => {
    const { service, exports, artifacts } = setup({
      pageSize: 2,
      clock: () => '2026-10-09T00:00:00.000Z',
    });
    const tempPath = join(tmpdir(), `aasc-export-${process.pid}-${Date.now()}.csv`);
    artifacts.createTemp.mockResolvedValueOnce(tempPath);
    artifacts.openTemp.mockResolvedValueOnce({ stream: {}, size: 12 });
    const row = (localLeadId: string, name: string) => ({
      localLeadId,
      remoteLeadId: null,
      name,
      email: null,
      phone: null,
      campaignId: null,
      campaignName: null,
      adId: null,
      adName: null,
      formId: null,
      formName: null,
      receivedAt: new Date('2026-10-08T00:00:00.000Z'),
      score: 0,
      syncStatus: 'synced',
      remoteDealId: null,
      pipelineId: null,
      stageId: null,
      assignedTo: null,
      amount: null,
      currency: null,
      convertedAt: null,
    });
    const firstPage = [row('lead-1', 'An'), row('lead-2', 'Binh')];
    const secondPage = [row('lead-3', 'Chi')];
    exports.snapshot.mockImplementationOnce((_timeout, run) =>
      run({}, new Date('2026-10-09T00:00:00.000Z')),
    );
    exports.page
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([]);

    const artifact = await service.download({ format: 'csv' }, { sub: 'user-1' } as never);

    expect(artifact).toMatchObject({
      size: 12,
      rowCount: 3,
      filename: 'leads-20261009T000000000Z.csv',
      metadata: { snapshotAt: '2026-10-09T00:00:00.000Z' },
    });
    expect(exports.page).toHaveBeenNthCalledWith(1, expect.anything(), null, 2, {});
    expect(exports.page).toHaveBeenNthCalledWith(2, expect.anything(), 'lead-2', 2, {});
    expect(artifacts.openTemp).toHaveBeenCalledWith(tempPath);
    expect(artifacts.discard).not.toHaveBeenCalled();
    await rm(tempPath, { force: true });
  });

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

  it('queues a valid export and enforces the active-job limit inside the requester lock', async () => {
    const state = setup();
    await expect(
      state.service.schedule({ format: 'json', from: '2026-10-01', to: '2026-10-09' }, {
        sub: 'user-1',
      } as never),
    ).resolves.toMatchObject({ id: 'job-1', format: 'csv' });
    expect(state.jobs.lockRequester).toHaveBeenCalledWith('user-1', expect.anything());
    expect(state.operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'integration_report', actorId: 'user-1' }),
      expect.anything(),
    );
    expect(state.outbox.append).toHaveBeenCalledTimes(1);

    const full = setup();
    full.jobs.countActive.mockResolvedValueOnce(2);
    await expect(
      full.service.schedule({ format: 'csv' }, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ status: 429, response: { code: 'EXPORT_JOB_LIMIT' } });
    expect(full.jobs.create).not.toHaveBeenCalled();
  });

  it('checks job ownership and rejects synchronous exports above their row limit', async () => {
    const state = setup({ syncLimit: 1 });
    await expect(
      state.service.getJob('job-1', { sub: 'user-1', roles: ['integration_admin'] } as never),
    ).resolves.toMatchObject({ id: 'job-1', format: 'csv' });
    state.jobs.findById.mockResolvedValueOnce(null);
    await expect(
      state.service.getJob('missing', { sub: 'user-1', roles: [] } as never),
    ).rejects.toThrow('was not found');
    state.exports.count.mockResolvedValueOnce(2);
    state.exports.snapshot.mockImplementationOnce((_timeout, work) => work({}, new Date()));
    await expect(
      state.service.download({ format: 'csv' }, { sub: 'user-1' } as never),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_REQUIRES_ASYNC' } });
    expect(state.artifacts.discard).toHaveBeenCalledWith('/tmp/export-test.csv');
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
