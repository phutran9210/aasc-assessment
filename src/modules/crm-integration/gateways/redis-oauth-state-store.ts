import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import { ensureRedisConnected } from '../../../core/queue/ensure-redis-connected.js';
import type { OAuthStateStore } from '../../../modules/bitrix/ports/bitrix-oauth-state-store.port.js';

const CONSUME_STATE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

/** Redis-backed one-time OAuth state, shared by all API replicas. */
export class RedisOAuthStateStore implements OAuthStateStore {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  async issue(ttlMs: number): Promise<string> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new RangeError('ttlMs must be positive');
    await ensureRedisConnected(this.redis);
    const state = randomUUID();
    const result = await this.redis.set(this.key(state), '1', 'PX', ttlMs, 'NX');
    if (result !== 'OK') throw new Error('Could not reserve OAuth state');
    return state;
  }

  async consume(state: string): Promise<boolean> {
    await ensureRedisConnected(this.redis);
    return (await this.redis.eval(CONSUME_STATE_SCRIPT, 1, this.key(state))) === 1;
  }

  private key(state: string): string {
    return `${this.namespace}:oauth-state:${state}`;
  }
}
