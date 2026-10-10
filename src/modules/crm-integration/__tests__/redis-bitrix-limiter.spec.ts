import { HttpException } from '@nestjs/common';

import { RedisBitrixLimiter } from '../gateways/redis-bitrix-limiter.js';

describe('RedisBitrixLimiter', () => {
  it('reserves immediately, sleeps for a granted delay, and rejects a full queue', async () => {
    const redis = { status: 'ready', eval: jest.fn().mockResolvedValue(0) };
    const limiter = new RedisBitrixLimiter(redis as never, 'test', 'portal name', {
      intervalMs: 5,
      maxWaitMs: 10,
    });
    await expect(limiter.acquire()).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'test:bitrix:portal%20name:next',
      'test:bitrix:portal%20name:cooldown',
      expect.any(Number),
      5,
      10,
    );

    redis.eval.mockResolvedValueOnce(-1);
    await expect(limiter.acquire()).rejects.toBeInstanceOf(HttpException);

    jest.useFakeTimers();
    redis.eval.mockResolvedValueOnce(3);
    const waiting = limiter.acquire();
    await jest.advanceTimersByTimeAsync(3);
    await expect(waiting).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it('saturates the cooldown key and defaults cooldown to the configured interval', async () => {
    const redis = { status: 'ready', eval: jest.fn().mockResolvedValue(1) };
    const limiter = new RedisBitrixLimiter(redis as never, 'app', 'portal', { intervalMs: 25 });
    await limiter.saturate();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'app:bitrix:portal:cooldown',
      expect.any(Number),
      25,
    );
  });
});
