import { ReportScheduler } from '../services/report-scheduler.service.js';

function setup() {
  const manager = { query: jest.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: jest.fn((callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
  };
  const jobs = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const operations = {
    findByKey: jest.fn().mockResolvedValue(null),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-1' }),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const configurations = { revisions: jest.fn().mockResolvedValue({ reports: 3 }) };
  const scope = { tiktokMode: 'mock', bitrixMode: 'live' };
  const service = new ReportScheduler(
    dataSource as never,
    jobs as never,
    operations as never,
    outbox as never,
    configurations as never,
    scope as never,
  );
  return { service, manager, jobs, operations, outbox, configurations };
}

describe('ReportScheduler', () => {
  it('creates one report for the previous local day after the scheduled hour', async () => {
    const { service, jobs, operations, outbox } = setup();

    await expect(service.tick('2026-10-11T02:00:00.000Z')).resolves.toMatchObject({
      reportType: 'daily-leads',
      period: '2026-10-10',
      created: true,
      jobId: 'job-1',
    });
    expect(jobs.create.mock.calls[0]?.[0]).toMatchObject({
      kind: 'scheduled',
      filters: {
        from: '2026-10-09T17:00:00.000Z',
        to: '2026-10-10T17:00:00.000Z',
        policyRevision: 3,
      },
    });
    expect(operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKey: 'scheduled-report/3/daily-leads/2026-10-10',
        payload: { reportJobId: 'job-1' },
      }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('uses the previous due period before 08:00 and falls back to revision zero', async () => {
    const { service, configurations, jobs } = setup();
    configurations.revisions.mockResolvedValueOnce({});

    await expect(service.tick('2026-10-11T00:30:00.000Z')).resolves.toMatchObject({
      period: '2026-10-09',
      created: true,
    });
    expect(jobs.create.mock.calls[0]?.[0].filters).toMatchObject({
      from: '2026-10-08T17:00:00.000Z',
      to: '2026-10-09T17:00:00.000Z',
      policyRevision: 0,
    });
  });

  it('returns the existing job instead of enqueuing a duplicate report', async () => {
    const { service, operations, jobs, outbox } = setup();
    operations.findByKey.mockResolvedValueOnce({ aggregateId: null });

    await expect(service.tick('2026-10-11T02:00:00.000Z')).resolves.toMatchObject({
      created: false,
      jobId: null,
    });
    expect(jobs.create).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
