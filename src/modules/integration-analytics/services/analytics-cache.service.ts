import { createHash } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import type { Scope } from '@modules/crm-integration/types/integration.types.js';

export const ANALYTICS_CACHE_TTL_SECONDS = 15;

export type AnalyticsCacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export type AnalyticsCacheOptions = {
  ttlSeconds?: number;
  /** Loaders allowed to hit PostgreSQL at once while the cache store is unavailable. */
  fallbackConcurrency?: number;
  maxQueued?: number;
  keyPrefix?: string;
};

/**
 * Read-through cache for analytics responses. The key carries the analytics revision, so a
 * committed change to leads, deals or costs is visible on the next request instead of after the
 * TTL; identical concurrent requests share one computation. When Redis fails the loader still
 * runs, behind a small limiter so an outage cannot stampede the database.
 */
@Injectable()
export class AnalyticsCache {
  private readonly logger = new Logger(AnalyticsCache.name);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private readonly ttlSeconds: number;
  private readonly fallbackConcurrency: number;
  private readonly maxQueued: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly store: AnalyticsCacheStore,
    options: AnalyticsCacheOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? ANALYTICS_CACHE_TTL_SECONDS;
    this.fallbackConcurrency = options.fallbackConcurrency ?? 4;
    this.maxQueued = options.maxQueued ?? 64;
    this.keyPrefix = options.keyPrefix ?? 'analytics';
  }

  getOrCompute<T>(
    scope: Scope,
    revision: string,
    query: unknown,
    loader: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(scope, revision, query);
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const computation = this.resolve(key, loader).finally(() => this.inflight.delete(key));
    this.inflight.set(key, computation);
    return computation;
  }

  private async resolve<T>(key: string, loader: () => Promise<T>): Promise<T> {
    let cached: string | null;
    try {
      cached = await this.store.get(key);
    } catch (error) {
      this.logger.warn(`Analytics cache unavailable, reading from the database: ${name(error)}`);
      return this.limited(loader);
    }
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // A corrupted entry is recomputed and overwritten below.
      }
    }

    const value = await loader();
    try {
      await this.store.set(key, JSON.stringify(value), this.ttlSeconds);
    } catch (error) {
      this.logger.warn(`Analytics cache write failed: ${name(error)}`);
    }
    return value;
  }

  private async limited<T>(loader: () => Promise<T>): Promise<T> {
    if (this.running >= this.fallbackConcurrency) {
      if (this.waiting.length >= this.maxQueued) {
        throw new ServiceUnavailableException('Analytics is temporarily overloaded');
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await loader();
    } finally {
      const next = this.waiting.shift();
      // A queued caller inherits the slot, so `running` only drops when nobody is waiting.
      if (next) next();
      else this.running -= 1;
    }
  }

  private key(scope: Scope, revision: string, query: unknown): string {
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          scope.advertiserId,
          scope.portalKey,
          scope.tiktokMode,
          scope.bitrixMode,
          revision,
          canonical(query),
        ]),
      )
      .digest('hex');
    return `${this.keyPrefix}:v1:${digest}`;
  }
}

/** Redis-backed store on the shared connection factory; every failure surfaces to the cache. */
export class RedisAnalyticsCacheStore implements AnalyticsCacheStore {
  private client?: Redis;
  private connecting?: Promise<void>;

  constructor(private readonly redis: RedisConnectionFactory) {}

  async get(key: string): Promise<string | null> {
    return (await this.connected()).get(this.qualify(key));
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await (await this.connected()).set(this.qualify(key), value, 'EX', ttlSeconds);
  }

  private qualify(key: string): string {
    return `${this.redis.prefix}:${key}`;
  }

  private async connected(): Promise<Redis> {
    this.client ??= this.redis.producer();
    const client = this.client;
    if (client.status === 'ready') return client;
    if (client.status === 'end') {
      this.client = undefined;
      return this.connected();
    }
    this.connecting ??= (
      client.status === 'wait' ? client.connect() : waitUntilReady(client)
    ).finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
    return client;
  }
}

function waitUntilReady(client: Redis): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis connection timed out')), 500);
    timer.unref();
    client.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function name(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
