import { ServiceUnavailableException } from '@nestjs/common';

import type { Scope } from '@modules/crm-integration/types/integration.types.js';
import { AnalyticsCache } from '../services/analytics-cache.service.js';
import type { AnalyticsCacheStore } from '../services/analytics-cache.service.js';

const scope: Scope = {
  advertiserId: 'adv-1',
  portalKey: 'portal-1',
  tiktokMode: 'mock',
  bitrixMode: 'mock',
};

class MemoryStore implements AnalyticsCacheStore {
  readonly values = new Map<string, string>();
  readonly ttls: number[] = [];
  failing = false;

  get(key: string): Promise<string | null> {
    if (this.failing) return Promise.reject(new Error('redis down'));
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.failing) return Promise.reject(new Error('redis down'));
    this.values.set(key, value);
    this.ttls.push(ttlSeconds);
    return Promise.resolve();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('analytics cache', () => {
  it('computes once and serves the stored value for the same scope, revision and query', async () => {
    const store = new MemoryStore();
    const cache = new AnalyticsCache(store);
    const loader = jest.fn().mockResolvedValue({ leads: 10 });

    const first = await cache.getOrCompute(scope, '7', { to: 'b', from: 'a' }, loader);
    const second = await cache.getOrCompute(scope, '7', { from: 'a', to: 'b' }, loader);

    expect(first).toEqual({ leads: 10 });
    expect(second).toEqual({ leads: 10 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.ttls).toEqual([15]);
  });

  it('recomputes when the revision, the query or the scope changes', async () => {
    const cache = new AnalyticsCache(new MemoryStore());
    const loader = jest.fn().mockResolvedValue(1);

    await cache.getOrCompute(scope, '7', { from: 'a' }, loader);
    await cache.getOrCompute(scope, '8', { from: 'a' }, loader);
    await cache.getOrCompute(scope, '8', { from: 'b' }, loader);
    await cache.getOrCompute({ ...scope, advertiserId: 'adv-2' }, '8', { from: 'b' }, loader);

    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('shares one computation between concurrent identical requests', async () => {
    const cache = new AnalyticsCache(new MemoryStore());
    const gate = deferred<number>();
    const loader = jest.fn(() => gate.promise);

    const requests = Array.from({ length: 5 }, () =>
      cache.getOrCompute(scope, '1', { from: 'a' }, loader),
    );
    await new Promise((resolve) => setImmediate(resolve));
    gate.resolve(42);

    expect(await Promise.all(requests)).toEqual([42, 42, 42, 42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed computation', async () => {
    const cache = new AnalyticsCache(new MemoryStore());
    const loader = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(3);

    await expect(cache.getOrCompute(scope, '1', {}, loader)).rejects.toThrow('db down');
    expect(await cache.getOrCompute(scope, '1', {}, loader)).toBe(3);
  });

  it('falls back to the loader when the cache store fails, at most two at a time', async () => {
    const store = new MemoryStore();
    store.failing = true;
    const cache = new AnalyticsCache(store, { fallbackConcurrency: 2, maxQueued: 10 });
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const requests = gates.map((gate, index) =>
      cache.getOrCompute(scope, '1', { index }, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
        return index;
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(running).toBe(2);
    gates.forEach((gate) => gate.resolve());

    expect(await Promise.all(requests)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it('sheds load with 503 when the fallback queue is full', async () => {
    const store = new MemoryStore();
    store.failing = true;
    const cache = new AnalyticsCache(store, { fallbackConcurrency: 1, maxQueued: 1 });
    const gate = deferred<number>();

    const first = cache.getOrCompute(scope, '1', { index: 1 }, () => gate.promise);
    await new Promise((resolve) => setImmediate(resolve));
    const second = cache.getOrCompute(scope, '1', { index: 2 }, () => Promise.resolve(2));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      cache.getOrCompute(scope, '1', { index: 3 }, () => Promise.resolve(3)),
    ).rejects.toThrow(ServiceUnavailableException);
    gate.resolve(1);
    expect(await Promise.all([first, second])).toEqual([1, 2]);
  });

  it('still returns the computed value when only the write to the store fails', async () => {
    const store = new MemoryStore();
    const cache = new AnalyticsCache(store);
    store.set = () => Promise.reject(new Error('readonly replica'));

    expect(await cache.getOrCompute(scope, '1', {}, () => Promise.resolve('ok'))).toBe('ok');
  });

  it('ignores a corrupted cache entry', async () => {
    const store = new MemoryStore();
    const cache = new AnalyticsCache(store);
    await cache.getOrCompute(scope, '1', {}, () => Promise.resolve('first'));
    for (const key of store.values.keys()) store.values.set(key, '{broken');

    expect(await cache.getOrCompute(scope, '1', {}, () => Promise.resolve('second'))).toBe(
      'second',
    );
  });
});
