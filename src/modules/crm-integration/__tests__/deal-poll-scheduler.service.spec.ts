import { DealPollSchedulerService } from '../services/deal-poll-scheduler.service.js';

describe('DealPollSchedulerService', () => {
  const priorSchedulerSetting = process.env.INTEGRATION_SCHEDULER_ENABLED;

  afterEach(() => {
    if (priorSchedulerSetting === undefined) delete process.env.INTEGRATION_SCHEDULER_ENABLED;
    else process.env.INTEGRATION_SCHEDULER_ENABLED = priorSchedulerSetting;
    jest.useRealTimers();
  });

  it('does not start polling when the scheduler is disabled', () => {
    process.env.INTEGRATION_SCHEDULER_ENABLED = 'false';
    const polls = { run: jest.fn(), isFullScanDue: jest.fn() };
    const scheduler = new DealPollSchedulerService(polls as never);

    scheduler.onModuleInit();

    expect(polls.run).not.toHaveBeenCalled();
    scheduler.onApplicationShutdown();
  });

  it('runs the initial incremental poll and a full scan only when due', async () => {
    jest.useFakeTimers();
    process.env.INTEGRATION_SCHEDULER_ENABLED = 'true';
    const polls = {
      run: jest.fn().mockResolvedValue({ complete: true, skippedLocked: false }),
      isFullScanDue: jest.fn().mockResolvedValue(true),
    };
    const scheduler = new DealPollSchedulerService(polls as never);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    expect(polls.run.mock.calls.map(([mode]) => mode)).toEqual(['incremental', 'full']);
    scheduler.onApplicationShutdown();
  });

  it('retries a poll that skipped a held lock after one minute', async () => {
    jest.useFakeTimers();
    process.env.INTEGRATION_SCHEDULER_ENABLED = 'true';
    const polls = {
      run: jest
        .fn()
        .mockResolvedValueOnce({ complete: false, skippedLocked: true })
        .mockResolvedValue({ complete: true, skippedLocked: false }),
      isFullScanDue: jest.fn().mockResolvedValue(false),
    };
    const scheduler = new DealPollSchedulerService(polls as never);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(polls.run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(polls.run).toHaveBeenCalledTimes(2);
    scheduler.onApplicationShutdown();
  });
});
