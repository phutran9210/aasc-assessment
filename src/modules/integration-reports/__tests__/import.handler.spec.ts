import { ImportHandler } from '../workers/import.handler.js';

describe('ImportHandler', () => {
  const operation = { payload: { reportJobId: 'job-1' } };
  let storedOperation: { payload: Record<string, unknown> } | null;
  let job: Record<string, unknown> | null;
  let jobs: { findById: jest.Mock; update: jest.Mock };
  let leadImports: { processChunk: jest.Mock };
  let costImports: { processChunk: jest.Mock };
  let ownership: jest.Mock;
  let handler: ImportHandler;

  beforeEach(() => {
    storedOperation = operation;
    job = { id: 'job-1', kind: 'import', status: 'running', cursor: '0', filters: {} };
    jobs = { findById: jest.fn(() => job), update: jest.fn() };
    leadImports = { processChunk: jest.fn().mockResolvedValue({ done: true, nextCursor: 1 }) };
    costImports = { processChunk: jest.fn().mockResolvedValue({ done: true, nextCursor: 1 }) };
    ownership = jest.fn();
    const repo = { findOne: jest.fn(() => storedOperation) };
    const dataSource = { getRepository: jest.fn(() => repo) };
    handler = new ImportHandler(
      dataSource as never,
      jobs as never,
      leadImports as never,
      costImports as never,
    );
  });

  const context = (attempt: number) => ({
    operationId: 'op-1',
    attempt,
    assertOwnership: ownership,
  });

  it('quarantines missing operation/job data and terminally handles finished jobs', async () => {
    storedOperation = null;
    await expect(handler.handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
    storedOperation = { payload: {} };
    await expect(handler.handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
    job = null;
    await expect(handler.handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
    job = { id: 'job-1', kind: 'export', status: 'running' };
    await expect(handler.handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_NOT_FOUND',
    });
    storedOperation = operation;
    job = { id: 'job-1', kind: 'import', status: 'completed' };
    await expect(handler.handle(context(1) as never)).resolves.toEqual({ outcome: 'succeeded' });
    job = { id: 'job-1', kind: 'import', status: 'failed' };
    await expect(handler.handle(context(1) as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'REPORT_JOB_FAILED',
    });
  });

  it('closes jobs abandoned beyond the attempt limit', async () => {
    await expect(handler.handle(context(6) as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'REPORT_WORKER_ABANDONED',
    });
    expect(jobs.update).toHaveBeenCalledWith('job-1', {
      status: 'failed',
      errorSummary: 'REPORT_WORKER_ABANDONED',
    });
    expect(ownership).not.toHaveBeenCalled();
  });

  it('processes lead and cost chunks until done and passes the durable cursor', async () => {
    leadImports.processChunk
      .mockResolvedValueOnce({ done: false, nextCursor: 25 })
      .mockResolvedValueOnce({ done: true, nextCursor: 50 });
    await expect(handler.handle(context(1) as never)).resolves.toEqual({ outcome: 'succeeded' });
    expect(ownership).toHaveBeenCalledTimes(2);
    expect(leadImports.processChunk).toHaveBeenNthCalledWith(1, 'job-1', 0, 200, expect.anything());
    expect(leadImports.processChunk).toHaveBeenNthCalledWith(
      2,
      'job-1',
      25,
      200,
      expect.anything(),
    );

    job = {
      id: 'job-1',
      kind: 'import',
      status: 'running',
      cursor: 4,
      filters: { type: 'campaign_costs' },
    };
    await expect(handler.handle(context(1) as never)).resolves.toEqual({ outcome: 'succeeded' });
    expect(costImports.processChunk).toHaveBeenCalledWith('job-1', 4, 200);
  });

  it('keeps the last cursor on failure and retries until the final attempt, then dead-letters', async () => {
    leadImports.processChunk.mockRejectedValue(new Error('failure'));
    await expect(handler.handle(context(2) as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'IMPORT_FAILED',
      nextAttemptAt: expect.any(Date),
    });
    expect(jobs.update).toHaveBeenCalledWith('job-1', { errorSummary: 'IMPORT_FAILED' });
    await expect(handler.handle(context(5) as never)).resolves.toEqual({
      outcome: 'dead_letter',
      errorCode: 'IMPORT_FAILED',
    });
    expect(jobs.update).toHaveBeenLastCalledWith('job-1', {
      status: 'failed',
      errorSummary: 'IMPORT_FAILED',
    });
  });
});
