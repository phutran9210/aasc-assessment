import type { LeadSyncConfig } from '@config/index.js';

import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { LEAD_SYNC_JOB, SyncScheduler } from '../services/sync-scheduler.service.js';
import type { SyncRunner } from '../services/sync-runner.service.js';

const config = (cron?: string): LeadSyncConfig => ({
  mappingPath: 'config/mapping.json',
  cron,
  timezone: 'Asia/Ho_Chi_Minh',
  direction: 'sheet-to-bitrix',
  defaultCountry: 'VN',
  maxRetries: 0,
  logRetentionDays: 30,
  batchSize: 25,
  retryBaseDelayMs: 0,
  lockStaleMs: 120_000,
  publicUrl: undefined,
  outgoingToken: undefined,
  eventDebounceMs: 0,
  eventRetryMs: 0,
});

describe('SyncScheduler', () => {
  const runner = { start: jest.fn() };
  let registry: SchedulerRegistry;

  const build = (cron?: string): SyncScheduler =>
    new SyncScheduler(registry, runner as unknown as SyncRunner, config(cron));

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    jest.resetAllMocks();
    registry = new SchedulerRegistry();
  });

  afterEach(() => {
    if (registry.doesExist('cron', LEAD_SYNC_JOB)) void registry.getCronJob(LEAD_SYNC_JOB).stop();
  });

  it('should register nothing when LEAD_SYNC_CRON is empty', () => {
    const scheduler = build();

    expect(scheduler.start()).toBe(false);
    expect(registry.doesExist('cron', LEAD_SYNC_JOB)).toBe(false);
    expect(scheduler.nextRunAt()).toBeNull();
  });

  it('should not register anything by merely being constructed', () => {
    build('*/15 * * * *');

    expect(registry.getCronJobs().size).toBe(0);
  });

  it('should register one job from the configured expression and report its next run', () => {
    const scheduler = build('*/15 * * * *');

    expect(scheduler.start()).toBe(true);
    expect(scheduler.start()).toBe(true);

    expect(registry.getCronJobs().size).toBe(1);
    expect(scheduler.nextRunAt()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45):00/);
  });

  it('should start a run with trigger "schedule" on every tick and wait for it', async () => {
    let finished = false;
    runner.start.mockResolvedValue({
      run: { id: 'run-1' },
      done: Promise.resolve().then(() => {
        finished = true;
      }),
    });

    await build('*/15 * * * *').tick();

    expect(runner.start).toHaveBeenCalledWith({ trigger: 'schedule' });
    expect(finished).toBe(true);
  });

  it.each([
    ['another run is still in progress', new LeadSyncBusyError('run-0')],
    ['the integration is not configured yet', new LeadSyncConfigError('Chưa cấu hình')],
    ['something unexpected fails', new Error('boom')],
  ])('should skip the tick quietly when %s', async (_case, error) => {
    runner.start.mockRejectedValue(error);

    await expect(build('*/15 * * * *').tick()).resolves.toBeUndefined();
  });
});
