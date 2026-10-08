import { sleep } from '@common/utils/index.js';
import { ensureRedisConnected } from '@core/queue/ensure-redis-connected.js';
import type { Redis } from 'ioredis';

import { HttpException, HttpStatus } from '@nestjs/common';

import type { BitrixRequestLimiter } from '@modules/bitrix/ports/bitrix-request-limiter.port.js';

const RESERVE_SLOT_SCRIPT = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local maxWait = tonumber(ARGV[3])
local cooldown = tonumber(redis.call('GET', KEYS[2]) or '0')
local nextAt = tonumber(redis.call('GET', KEYS[1]) or '0')
local slotAt = math.max(now, cooldown, nextAt)
local delay = slotAt - now
if delay > maxWait then return -1 end
redis.call('SET', KEYS[1], slotAt + interval, 'PX', math.max(interval * 2, maxWait + interval))
return delay
`;

const SATURATE_SCRIPT = `
local untilAt = tonumber(ARGV[1]) + tonumber(ARGV[2])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current < untilAt then
  redis.call('SET', KEYS[1], untilAt, 'PX', tonumber(ARGV[2]) * 2)
end
return 1
`;

export type RedisBitrixLimiterOptions = {
  intervalMs?: number;
  maxWaitMs?: number;
  cooldownMs?: number;
};

/** Cross-process Bitrix request pacing and 429 cooldown, scoped to one portal key. */
export class RedisBitrixLimiter implements BitrixRequestLimiter {
  private readonly intervalMs: number;
  private readonly maxWaitMs: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly redis: Redis,
    namespace: string,
    portalKey: string,
    options: RedisBitrixLimiterOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.maxWaitMs = options.maxWaitMs ?? 30_000;
    this.cooldownMs = options.cooldownMs ?? this.intervalMs;
    const keyScope = encodeURIComponent(portalKey);
    this.bucketKey = `${namespace}:bitrix:${keyScope}:next`;
    this.cooldownKey = `${namespace}:bitrix:${keyScope}:cooldown`;
  }

  private readonly bucketKey: string;
  private readonly cooldownKey: string;

  async acquire(): Promise<void> {
    await ensureRedisConnected(this.redis);
    const delayMs = Number(
      await this.redis.eval(
        RESERVE_SLOT_SCRIPT,
        2,
        this.bucketKey,
        this.cooldownKey,
        Date.now(),
        this.intervalMs,
        this.maxWaitMs,
      ),
    );
    if (delayMs < 0) {
      throw new HttpException('Bitrix24 rate limit queue is full', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  async saturate(): Promise<void> {
    await ensureRedisConnected(this.redis);
    await this.redis.eval(SATURATE_SCRIPT, 1, this.cooldownKey, Date.now(), this.cooldownMs);
  }
}
