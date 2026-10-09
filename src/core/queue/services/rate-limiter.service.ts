import type { RedisConnectionFactory } from '../redis-connection.js';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Time until the current window ends; meaningful when `allowed` is false. */
  retryAfterMs: number;
};

export type RateLimiter = {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
};

export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const LOCAL_RATE_LIMITER = Symbol('LOCAL_RATE_LIMITER');

// Atomic fixed window: the first hit of a window sets its expiry.
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** Fixed-window limiter shared by every process through Redis; a Redis failure is thrown. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisConnectionFactory) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const client = await this.redis.shared();
    const [count, ttl] = (await client.eval(
      CONSUME,
      1,
      `${this.redis.prefix}:rate:${key}`,
      String(windowMs),
    )) as [number, number];
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: Math.max(0, ttl),
    };
  }
}

/**
 * Per-process fixed-window limiter: the hard ingress limit that still holds when Redis is down.
 * The table is bounded, so a flood of distinct keys cannot grow memory without limit.
 */
export class LocalRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.clock();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.evict(now);
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= limit,
      remaining: Math.max(0, limit - window.count),
      retryAfterMs: Math.max(0, window.resetAt - now),
    };
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest entries first.
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }
}

type AddressSource = {
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Address used for rate limiting. `X-Forwarded-For` is honoured only when the TCP peer is an
 * allow-listed proxy, and then the nearest hop that is not itself a trusted proxy is used; a
 * client cannot pick its own identity by sending the header directly.
 */
export function clientIp(request: AddressSource, trustedProxies: readonly string[]): string {
  const peer = normalizeAddress(request.socket?.remoteAddress);
  if (!peer) return 'unknown';
  if (!trustedProxies.includes(peer)) return peer;

  const header = request.headers['x-forwarded-for'];
  const hops = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((hop) => normalizeAddress(hop))
    .filter((hop): hop is string => Boolean(hop));
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!trustedProxies.includes(hops[index])) return hops[index];
  }
  return peer;
}

function normalizeAddress(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}
