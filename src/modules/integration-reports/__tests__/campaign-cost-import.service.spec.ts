import { CampaignCostImportService } from '../services/campaign-cost-import.service.js';

describe('CampaignCostImportService', () => {
  const records = [
    { rowNumber: 1, values: null },
    { rowNumber: 2, values: null, errorCode: 'ROW_COLUMN_COUNT_MISMATCH' },
    {
      rowNumber: 3,
      values: {
        advertiser_id: 'other',
        campaign_id: 'c1',
        date: '2026-01-01',
        currency: 'usd',
        spend: '1',
      },
    },
    {
      rowNumber: 4,
      values: {
        advertiser_id: 'adv-1',
        campaign_id: 'c1',
        date: '2026-01-01',
        currency: 'usd',
        spend: '1.2300',
        impressions: '',
        clicks: '3',
      },
    },
    {
      rowNumber: 5,
      values: {
        advertiser_id: 'adv-1',
        campaign_id: 'c2',
        date: 'bad',
        currency: 'US D',
        spend: '1',
      },
    },
  ];
  const job = { cursor: '0', status: 'running' };
  const support = {
    register: jest.fn(),
    load: jest.fn(),
    replayed: jest.fn(() => ({ processed: 0, succeeded: 0, failed: 0, nextCursor: 5, done: true })),
    checkpoint: jest.fn(),
    recordErrors: jest.fn(),
  };
  const costs = { upsert: jest.fn() };
  const dataSource = { transaction: jest.fn((run: (tx: object) => Promise<unknown>) => run({})) };
  const service = new CampaignCostImportService(
    dataSource as never,
    support as never,
    costs as never,
    { advertiserId: 'adv-1', reportTimezone: 'UTC' },
  );

  beforeEach(() => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation((run) => run({}));
    support.replayed.mockReturnValue({
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: 5,
      done: true,
    });
  });

  it('registers CSV costs under the configured advertiser and timezone', async () => {
    support.register.mockResolvedValue({ id: 'job-1' });
    await expect(
      service.start({ path: '/tmp/cost.csv', originalName: 'cost.csv', size: 20 }, {
        sub: 'user-1',
      } as never),
    ).resolves.toEqual({ id: 'job-1' });
    const call = support.register.mock.calls[0];
    if (!call) throw new Error('expected import registration');
    const [input] = call;
    expect(input).toMatchObject({
      formats: ['csv'],
      filters: { type: 'campaign_costs', advertiserId: 'adv-1', reportingTimezone: 'UTC' },
      actor: { sub: 'user-1' },
    });
    expect(input.operationKey('job-1')).toBe('cost-import/job-1');
  });

  it('validates each chunk row, checkpoints it, records row errors, and upserts only valid costs', async () => {
    support.load.mockResolvedValue({ job, records });
    support.checkpoint.mockResolvedValue(true);
    const result = await service.processChunk('job-1', 0);
    expect(result).toEqual({ processed: 5, succeeded: 1, failed: 4, nextCursor: 5, done: true });
    expect(support.recordErrors).toHaveBeenCalledWith(
      'job-1',
      [
        { rowNumber: 1, sourceKey: null, errorCode: 'ROW_MALFORMED' },
        { rowNumber: 2, sourceKey: null, errorCode: 'ROW_COLUMN_COUNT_MISMATCH' },
        {
          rowNumber: 3,
          sourceKey: 'c1/2026-01-01/USD',
          errorCode: 'ADVERTISER_MISMATCH',
          redactedDetail: 'advertiser_id',
        },
        {
          rowNumber: 5,
          sourceKey: 'c2/bad/US D',
          errorCode: 'COST_INVALID_DATE',
          redactedDetail: 'reportDate',
        },
      ],
      expect.anything(),
    );
    expect(costs.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          advertiserId: 'adv-1',
          campaignId: 'c1',
          spend: '1.2300',
          clicks: '3',
          impressions: null,
        }),
      ],
      'import',
      expect.anything(),
    );
  });

  it('does not write rows when checkpoint loses a cursor race and handles replayed chunks', async () => {
    support.load.mockResolvedValue({ job, records });
    support.checkpoint.mockResolvedValue(false);
    await service.processChunk('job-1', 0, 2);
    expect(support.recordErrors).not.toHaveBeenCalled();
    expect(costs.upsert).not.toHaveBeenCalled();

    support.load.mockResolvedValueOnce({ job: { ...job, cursor: '3' }, records });
    await expect(service.processChunk('job-1', 0)).resolves.toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: 5,
      done: true,
    });
    expect(support.replayed).toHaveBeenCalledWith({ ...job, cursor: '3' });
    support.load.mockResolvedValueOnce({ job: { ...job, status: 'completed' }, records });
    await service.processChunk('job-1', 0);
    expect(support.replayed).toHaveBeenCalledTimes(2);
  });

  it('processes a caller-limited empty chunk as complete without an upsert', async () => {
    support.load.mockResolvedValue({ job, records: [] });
    support.checkpoint.mockResolvedValue(true);
    await expect(service.processChunk('job-1', 0, 10)).resolves.toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: 0,
      done: true,
    });
    expect(costs.upsert).not.toHaveBeenCalled();
  });
});
