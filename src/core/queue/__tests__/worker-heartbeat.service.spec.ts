import { WorkerHeartbeatService } from '../services/worker-heartbeat.service.js';

describe('WorkerHeartbeatService', () => {
  it('writes its own heartbeat and returns the freshest valid worker beat', async () => {
    const beats: Record<string, string> = { older: '1000', newer: '2000' };
    const client = {
      hset: jest.fn((_: string, workerId: string, value: string) => {
        beats[workerId] = value;
        return Promise.resolve(1);
      }),
      hgetall: jest.fn(() => Promise.resolve(beats)),
      hdel: jest.fn().mockResolvedValue(1),
    };
    const redis = { prefix: 'integration-test', shared: jest.fn().mockResolvedValue(client) };
    const heartbeat = new WorkerHeartbeatService(redis as never, 'worker-1', () => 3000);

    expect(await heartbeat.latestBeatAt()).toBe(2000);
    await heartbeat.beat();
    expect(await heartbeat.latestBeatAt()).toBe(3000);
    expect(client.hset).toHaveBeenCalledWith(
      'integration-test:worker-heartbeats',
      'worker-1',
      '3000',
    );
  });

  it('removes stale and malformed worker beats before deciding readiness', async () => {
    const client = {
      hgetall: jest.fn().mockResolvedValue({ malformed: 'NaN', stale: '1', fresh: '3599999' }),
      hdel: jest.fn().mockResolvedValue(1),
    };
    const redis = { prefix: 'integration-test', shared: jest.fn().mockResolvedValue(client) };
    const heartbeat = new WorkerHeartbeatService(redis as never, 'worker-1', () => 3_600_002);

    await expect(heartbeat.latestBeatAt()).resolves.toBe(3_599_999);
    expect(client.hdel.mock.calls.map(([, workerId]) => workerId)).toEqual(['malformed', 'stale']);
  });

  it('returns null when no worker has ever published a beat', async () => {
    const redis = {
      prefix: 'integration-test',
      shared: jest.fn().mockResolvedValue({ hgetall: jest.fn().mockResolvedValue({}) }),
    };
    const heartbeat = new WorkerHeartbeatService(redis as never, 'worker-1', () => 0);
    await expect(heartbeat.latestBeatAt()).resolves.toBeNull();
  });

  it('deletes its own heartbeat on shutdown after the timer has started', async () => {
    jest.useFakeTimers();
    const client = {
      hset: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1),
    };
    const redis = { prefix: 'integration-test', shared: jest.fn().mockResolvedValue(client) };
    const heartbeat = new WorkerHeartbeatService(redis as never, 'worker-1', () => 1000);
    try {
      heartbeat.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      await heartbeat.onApplicationShutdown();
      expect(client.hdel).toHaveBeenCalledWith('integration-test:worker-heartbeats', 'worker-1');
    } finally {
      jest.useRealTimers();
    }
  });
});
