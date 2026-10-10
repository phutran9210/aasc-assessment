import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ImportJobSupport, MAX_IMPORT_BYTES } from '../services/import-job.support.js';
import { LEAD_IMPORT_SCHEMA } from '../domain/import-parser.js';
import { ReportJobEntity } from '../entities/report-job.entity.js';

describe('ImportJobSupport', () => {
  let directory: string;
  let source: string;
  let support: ImportJobSupport;
  let jobs: { create: jest.Mock; findById: jest.Mock };
  let rowErrors: { record: jest.Mock };
  let artifacts: {
    finalize: jest.Mock;
    readImport: jest.Mock;
    purgeJob: jest.Mock;
    discard: jest.Mock;
  };
  let operations: { ensure: jest.Mock };
  let outbox: { append: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'import-job-support-'));
    source = join(directory, 'upload.csv');
    await writeFile(
      source,
      'advertiser_id,source_record_id,occurred_at,full_name\na,s,2026-01-01,A\n',
    );
    jobs = {
      create: jest.fn((input: Record<string, unknown>) => ({
        ...input,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
      findById: jest.fn(),
    };
    rowErrors = { record: jest.fn().mockResolvedValue(undefined) };
    artifacts = {
      finalize: jest
        .fn()
        .mockResolvedValue({ path: 'imports/job-1/file.csv', hash: 'hash', size: 80 }),
      readImport: jest.fn().mockResolvedValue({
        content: Buffer.from(
          'advertiser_id,source_record_id,occurred_at,full_name\na,s,2026-01-01,A\n',
        ),
        format: 'csv',
      }),
      purgeJob: jest.fn().mockResolvedValue(undefined),
      discard: jest.fn().mockResolvedValue(undefined),
    };
    operations = { ensure: jest.fn().mockResolvedValue({ id: 'op-1' }) };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: jest.fn((fn: (tx: object) => Promise<unknown>) => fn({})) };
    support = new ImportJobSupport(
      dataSource as never,
      jobs as never,
      rowErrors as never,
      artifacts as never,
      operations as never,
      outbox as never,
    );
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  const registration = (overrides: Record<string, unknown> = {}) => ({
    file: { path: source, originalName: 'leads.CSV', size: 999 },
    schema: LEAD_IMPORT_SCHEMA,
    formats: ['csv', 'json'] as const,
    filters: { source: 'historical' },
    operationKind: 'integration.report.import' as never,
    operationKey: (id: string) => `import/${id}`,
    actor: { sub: 'user-1', sid: 'sid', username: 'user', roles: ['admin'] },
    ...overrides,
  });

  it('registers a bounded file, writes the job and operation atomically, and runs the commit hook', async () => {
    const beforeCommit = jest.fn().mockResolvedValue(undefined);
    const result = await support.register(registration({ beforeCommit }) as never);
    expect(result).toMatchObject({ id: expect.any(String), kind: 'import' });
    expect(artifacts.finalize).toHaveBeenCalledWith(source, expect.any(String), {
      area: 'imports',
      format: 'csv',
    });
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: 'user-1', totalRows: 1, status: 'pending' }),
      expect.anything(),
    );
    expect(operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'integration.report.import', actorId: 'user-1' }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(artifacts.discard).not.toHaveBeenCalled();
  });

  it('rejects oversized and unsupported files and discards the upload', async () => {
    await writeFile(source, Buffer.alloc(MAX_IMPORT_BYTES + 1));
    await expect(support.register(registration() as never)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(artifacts.discard).toHaveBeenCalledWith(source);

    await writeFile(source, 'small');
    await expect(
      support.register(
        registration({ file: { path: source, originalName: 'leads.xlsx', size: 5 } }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(artifacts.finalize).not.toHaveBeenCalled();
    expect(artifacts.discard).toHaveBeenCalledTimes(2);
  });

  it('purges a finalized artifact when its database transaction fails', async () => {
    jobs.create.mockRejectedValueOnce(new Error('database failed'));
    await expect(support.register(registration() as never)).rejects.toThrow('database failed');
    expect(artifacts.purgeJob).toHaveBeenCalledWith(expect.any(String), 'imports');
    expect(artifacts.discard).toHaveBeenCalledWith(source);
  });

  it('loads only import jobs with supported stored formats and delegates row errors', async () => {
    const job = { id: 'job-1', kind: 'import' };
    jobs.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...job, kind: 'export' })
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(job);
    await expect(support.load('missing', LEAD_IMPORT_SCHEMA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(support.load('export', LEAD_IMPORT_SCHEMA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    artifacts.readImport.mockResolvedValueOnce({ content: Buffer.from('x'), format: 'xlsx' });
    await expect(support.load('job-1', LEAD_IMPORT_SCHEMA)).rejects.toThrow(
      'Import file format is not supported',
    );
    artifacts.readImport.mockResolvedValueOnce({
      content: Buffer.from('advertiser_id,source_record_id,occurred_at,full_name\na,s,t,A'),
      format: 'csv',
    });
    await expect(support.load('job-1', LEAD_IMPORT_SCHEMA)).resolves.toMatchObject({
      job,
      records: [{ rowNumber: 1 }],
    });
    await support.recordErrors('job-1', []);
    expect(rowErrors.record).toHaveBeenCalledWith('job-1', [], undefined);
  });

  it('checkpoints only the current non-completed cursor and reports replay state', async () => {
    const repo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
    const manager = { getRepository: jest.fn(() => repo) };
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cursor: '2', status: 'running' })
      .mockResolvedValueOnce({ cursor: 2, status: 'completed' })
      .mockResolvedValueOnce({ cursor: '2', status: 'running', successRows: 3, failedRows: 1 });
    await expect(
      support.checkpoint(
        'job-1',
        2,
        { processed: 1, succeeded: 1, failed: 0, nextCursor: 3, done: false },
        null,
        manager as never,
      ),
    ).resolves.toBe(false);
    await expect(
      support.checkpoint(
        'job-1',
        1,
        { processed: 1, succeeded: 1, failed: 0, nextCursor: 2, done: false },
        null,
        manager as never,
      ),
    ).resolves.toBe(false);
    await expect(
      support.checkpoint(
        'job-1',
        2,
        { processed: 1, succeeded: 1, failed: 0, nextCursor: 3, done: true },
        null,
        manager as never,
      ),
    ).resolves.toBe(false);
    await expect(
      support.checkpoint(
        'job-1',
        2,
        { processed: 1, succeeded: 1, failed: 2, nextCursor: 3, done: true },
        { imported: true },
        manager as never,
      ),
    ).resolves.toBe(true);
    expect(repo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        cursor: '3',
        successRows: 4,
        failedRows: 3,
        status: 'completed',
        filters: { imported: true },
      }),
    );
    expect(support.replayed({ cursor: null, status: 'running' } as ReportJobEntity)).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: 0,
      done: false,
    });
    expect(support.replayed({ cursor: '3', status: 'completed' } as ReportJobEntity).done).toBe(
      true,
    );
    expect(manager.getRepository).toHaveBeenCalledWith(ReportJobEntity);
  });
});
