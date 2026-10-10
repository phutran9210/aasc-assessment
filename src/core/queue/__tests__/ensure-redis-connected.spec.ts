import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { ensureRedisConnected } from '../ensure-redis-connected.js';

describe('ensureRedisConnected', () => {
  it('returns immediately when Redis is ready', async () => {
    const redis = Object.assign(new EventEmitter(), {
      status: 'ready',
      connect: jest.fn(),
    }) as unknown as Redis;
    await expect(ensureRedisConnected(redis)).resolves.toBeUndefined();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it('starts one lazy connection and retries after a rejected connection', async () => {
    const redis = Object.assign(new EventEmitter(), {
      status: 'wait',
      connect: jest.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined),
    }) as unknown as Redis;
    await expect(ensureRedisConnected(redis)).rejects.toThrow('refused');
    await expect(ensureRedisConnected(redis)).resolves.toBeUndefined();
    expect(redis.connect).toHaveBeenCalledTimes(2);
  });

  it('joins an in-progress connection and rejects on an emitted error', async () => {
    const redis = Object.assign(new EventEmitter(), {
      status: 'connecting',
      connect: jest.fn(),
    }) as unknown as Redis;
    const first = ensureRedisConnected(redis);
    const second = ensureRedisConnected(redis);
    expect(first).toBe(second);
    redis.emit('ready');
    await expect(first).resolves.toBeUndefined();
    expect(redis.listenerCount('ready')).toBe(0);

    const failed = Object.assign(new EventEmitter(), {
      status: 'connecting',
      connect: jest.fn(),
    }) as unknown as Redis;
    const pending = ensureRedisConnected(failed);
    failed.emit('error', new Error('offline'));
    await expect(pending).rejects.toThrow('offline');
    expect(failed.listenerCount('error')).toBe(0);
  });
});
