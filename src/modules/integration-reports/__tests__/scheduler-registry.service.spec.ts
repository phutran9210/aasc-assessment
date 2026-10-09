import { SchedulerRegistryService } from '../services/scheduler-registry.service.js';
import type { ScheduledTask } from '../services/scheduler-registry.service.js';

describe('scheduler registry', () => {
  afterEach(() => jest.useRealTimers());

  function task(run: ScheduledTask['run'], intervalMs = 1_000): ScheduledTask {
    return { name: 'probe', intervalMs, run };
  }

  it('does not start any timer when the scheduler flag is off', () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    const registry = new SchedulerRegistryService([task(run)], false);

    registry.onModuleInit();
    jest.advanceTimersByTime(10_000);

    expect(run).not.toHaveBeenCalled();
  });

  it('runs each task at start and on its interval until shutdown', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    const registry = new SchedulerRegistryService([task(run)], true);

    registry.onModuleInit();
    await jest.advanceTimersByTimeAsync(2_500);
    registry.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still in flight', async () => {
    let release!: () => void;
    const run = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const registry = new SchedulerRegistryService([task(run)], true);
    const probe = task(run);

    const first = registry.runTask(probe);
    await registry.runTask(probe);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;

    const next = registry.runTask(probe);
    release();
    await next;

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a task throws and passes the tick time through', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const registry = new SchedulerRegistryService([], true);
    const probe = task(run);

    await registry.runTask(probe, '2026-03-15T01:00:00.000Z');
    await registry.runTask(probe, '2026-03-15T01:01:00.000Z');

    expect(run).toHaveBeenNthCalledWith(2, '2026-03-15T01:01:00.000Z');
  });
});
