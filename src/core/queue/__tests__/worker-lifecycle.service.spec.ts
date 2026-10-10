const mockProcessors: Array<(job: { data?: { operationId?: unknown } }) => Promise<void>> = [];
const mockWorkers: Array<{ on: jest.Mock; close: jest.Mock }> = [];

jest.mock('bullmq', () => ({
  Worker: jest.fn(
    (_queue: string, processor: (job: { data?: { operationId?: unknown } }) => Promise<void>) => {
      mockProcessors.push(processor);
      const worker = {
        on: jest.fn().mockReturnThis(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockWorkers.push(worker);
      return worker;
    },
  ),
}));

import { Logger } from '@nestjs/common';
import { QUEUE_NAMES } from '../constants/operation.constants.js';
import { WorkerLifecycleService } from '../services/worker-lifecycle.service.js';

describe('WorkerLifecycleService', () => {
  beforeEach(() => {
    mockProcessors.length = 0;
    mockWorkers.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function setup() {
    const runner = { run: jest.fn().mockResolvedValue({ outcome: 'succeeded' }) };
    const dispatcher = { dispatchOnce: jest.fn().mockResolvedValue(undefined) };
    const recovery = { sweep: jest.fn().mockResolvedValue(undefined) };
    const redis = { worker: jest.fn(() => ({}) as never) };
    const service = new WorkerLifecycleService(
      redis as never,
      runner as never,
      'prefix',
      dispatcher as never,
      recovery as never,
    );
    return { service, runner, dispatcher, recovery, redis };
  }

  it('starts one worker per queue, runs valid jobs and rejects bad or incomplete outcomes', async () => {
    const state = setup();
    state.service.onModuleInit();
    expect(mockProcessors).toHaveLength(Object.keys(QUEUE_NAMES).length);
    expect(state.dispatcher.dispatchOnce).toHaveBeenCalledWith(50);
    expect(state.recovery.sweep).toHaveBeenCalledWith(100);
    await expect(
      mockProcessors[0]({ data: { operationId: 'operation-1' } }),
    ).resolves.toBeUndefined();
    expect(state.runner.run).toHaveBeenCalledWith('operation-1');
    await expect(mockProcessors[0]({ data: { operationId: 4 } })).rejects.toThrow(
      'Invalid operation job payload',
    );
    await expect(mockProcessors[0]({ data: { operationId: 'x'.repeat(65) } })).rejects.toThrow(
      'Invalid operation job payload',
    );
    state.runner.run.mockResolvedValueOnce({ outcome: 'retry_wait' });
    await expect(mockProcessors[0]({ data: { operationId: 'retry' } })).rejects.toThrow(
      'Operation ended as retry_wait',
    );
    await state.service.onApplicationShutdown();
    expect(mockWorkers.every((worker) => worker.close.mock.calls.length === 1)).toBe(true);
  });

  it('logs dispatch and recovery errors and prevents overlapping attempts', async () => {
    const state = setup();
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    state.dispatcher.dispatchOnce
      .mockRejectedValueOnce(new Error('dispatch'))
      .mockResolvedValue(undefined);
    state.recovery.sweep.mockRejectedValueOnce('recovery').mockResolvedValue(undefined);
    const internal = state.service as unknown as {
      dispatchOutbox: () => Promise<void>;
      runRecovery: () => Promise<void>;
    };
    await Promise.all([internal.dispatchOutbox(), internal.dispatchOutbox()]);
    await Promise.all([internal.runRecovery(), internal.runRecovery()]);
    expect(state.dispatcher.dispatchOnce).toHaveBeenCalledTimes(1);
    expect(state.recovery.sweep).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Outbox dispatch failed: Error'));
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Recovery sweep failed: UnknownError'),
    );
  });

  it('clears timers and closes all workers during application shutdown', async () => {
    const state = setup();
    state.service.onModuleInit();
    const clear = jest.spyOn(global, 'clearInterval');
    await state.service.onApplicationShutdown();
    expect(clear).toHaveBeenCalledTimes(2);
    expect(mockWorkers).toHaveLength(Object.keys(QUEUE_NAMES).length);
  });
});
