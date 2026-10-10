import { NotFoundException } from '@nestjs/common';
import { LeadSyncStatusService } from '../services/lead-sync-status.service.js';

const run = {
  id: 'run-1',
  trigger: 'http',
  status: 'completed',
  dryRun: false,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: null,
  total: 2,
  created: 1,
  updated: 0,
  skipped: 0,
  failed: 1,
  stopReason: null,
};

function service(
  options: {
    reason?: string | null;
    googleFails?: boolean;
    bitrixFails?: boolean;
    latest?: typeof run | null;
  } = {},
) {
  const runs = {
    list: jest.fn().mockResolvedValue([[run], 21]),
    findById: jest.fn().mockResolvedValue(run),
    findLatest: jest.fn().mockResolvedValue(options.latest === undefined ? run : options.latest),
  };
  const items = {
    findByRun: jest.fn().mockResolvedValue([
      {
        rowNumber: 3,
        action: 'failed',
        leadId: null,
        errorCode: 'BAD',
        errorMessage: 'bad row',
        attempts: 2,
      },
    ]),
  };
  const readiness = { missing: jest.fn().mockResolvedValue(options.reason ?? null) };
  const scheduler = { nextRunAt: jest.fn().mockReturnValue(new Date('2026-01-02T00:00:00.000Z')) };
  const sheets = {
    getSheetMeta: options.googleFails
      ? jest.fn().mockRejectedValue(new Error('sheets offline'))
      : jest.fn().mockResolvedValue({}),
  };
  const gateway = {
    getFieldNames: options.bitrixFails
      ? jest.fn().mockRejectedValue('bitrix offline')
      : jest.fn().mockResolvedValue([]),
  };
  const config = { cron: '*/15 * * * *', timezone: 'Asia/Ho_Chi_Minh' };
  return {
    target: new LeadSyncStatusService(
      runs as never,
      items as never,
      readiness as never,
      scheduler as never,
      sheets as never,
      gateway as never,
      config as never,
    ),
    runs,
    items,
    sheets,
    gateway,
  };
}

describe('LeadSyncStatusService', () => {
  it('paginates runs and includes run item details', async () => {
    const { target, runs, items } = service();
    expect(await target.listRuns(2, 10)).toMatchObject({
      data: [{ id: 'run-1', finishedAt: null }],
      meta: { total: 21, page: 2, limit: 10 },
    });
    expect(runs.list).toHaveBeenCalledWith(2, 10);
    expect(await target.getRun('run-1')).toMatchObject({
      id: 'run-1',
      items: [{ rowNumber: 3, errorCode: 'BAD' }],
    });
    expect(items.findByRun).toHaveBeenCalledWith('run-1');
  });

  it('reports configured and unavailable readiness with safe connection errors', async () => {
    const ready = service({ googleFails: true, bitrixFails: true });
    expect(await ready.target.getStatus()).toMatchObject({
      configured: true,
      reason: null,
      lastRun: { id: 'run-1' },
      connections: {
        google: { ok: false, message: 'sheets offline' },
        bitrix: { ok: false, message: 'bitrix offline' },
      },
    });
    const missing = service({ reason: 'Google Sheet ID is missing', latest: null });
    expect(await missing.target.getStatus()).toMatchObject({
      configured: false,
      lastRun: null,
      connections: {
        google: { ok: false, message: 'Google Sheet ID is missing' },
        bitrix: { ok: false, message: 'Google Sheet ID is missing' },
      },
      schedule: { cron: '*/15 * * * *' },
    });
    expect(missing.sheets.getSheetMeta).not.toHaveBeenCalled();
  });

  it('throws when a requested run does not exist', async () => {
    const setup = service();
    setup.runs.findById.mockResolvedValue(null);
    await expect(setup.target.getRun('missing')).rejects.toThrow(NotFoundException);
    expect(setup.items.findByRun).not.toHaveBeenCalled();
  });
});
