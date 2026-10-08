import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { PostgresBitrixInstallationRepository } from '../../src/modules/crm-integration/repositories/postgres-bitrix-installation.repository.js';
import { RedisOAuthStateStore } from '../../src/modules/crm-integration/gateways/redis-oauth-state-store.js';
import { RedisBitrixLimiter } from '../../src/modules/crm-integration/gateways/redis-bitrix-limiter.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { RefreshLease } from '../../src/modules/bitrix/types/bitrix-installation-snapshot.type.js';

const TOKEN_SET = {
  memberId: 'member-test-1',
  domain: 'portal.bitrix24.com',
  scope: 'crm',
  status: 'L',
  clientEndpoint: 'https://portal.bitrix24.com/rest/',
  serverEndpoint: 'https://oauth.bitrix.info/rest/',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  applicationToken: 'application-1',
  expiresIn: 3600,
};

function requireLease(lease: RefreshLease | null): RefreshLease {
  if (!lease) throw new Error('Expected a refresh lease');
  return lease;
}

function requireRedisUrl(): string {
  const redisUrl = process.env.TIKTOK_TEST_REDIS_URL;
  if (!redisUrl) throw new Error('TIKTOK_TEST_REDIS_URL is required');
  return redisUrl;
}

describe('TikTok Bitrix shared adapters', () => {
  it('should consume OAuth state once across two instances', async () => {
    const infrastructure = await createTestInfrastructure();
    const redisUrl = requireRedisUrl();
    const namespace = `${infrastructure.redisPrefix}:state-${randomUUID()}`;
    const redisA = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const redisB = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const stateA = new RedisOAuthStateStore(redisA, namespace);
    const stateB = new RedisOAuthStateStore(redisB, namespace);
    try {
      await Promise.all([redisA.connect(), redisB.connect()]);
      const state = await stateA.issue(30_000);

      await expect(stateB.consume(state)).resolves.toBe(true);
      await expect(stateA.consume(state)).resolves.toBe(false);
    } finally {
      await Promise.all([redisA.quit(), redisB.quit()]);
      await infrastructure.close();
    }
  });

  it('shares request pacing and upstream cooldown across limiter instances', async () => {
    const infrastructure = await createTestInfrastructure();
    const redisUrl = requireRedisUrl();
    const namespace = `${infrastructure.redisPrefix}:limit-${randomUUID()}`;
    const redisA = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const redisB = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const options = { intervalMs: 80, maxWaitMs: 1000, cooldownMs: 120 };
    const limiterA = new RedisBitrixLimiter(redisA, namespace, 'portal-test', options);
    const limiterB = new RedisBitrixLimiter(redisB, namespace, 'portal-test', options);
    try {
      await Promise.all([redisA.connect(), redisB.connect()]);
      await limiterA.acquire();
      await limiterA.saturate();
      const startedAt = Date.now();
      await limiterB.acquire();

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(options.cooldownMs - 20);
    } finally {
      await Promise.all([redisA.quit(), redisB.quit()]);
      await infrastructure.close();
    }
  });

  it('does not let a stale refresh owner release a takeover or overwrite reinstall tokens', async () => {
    const infrastructure = await createTestInfrastructure();
    const { database } = infrastructure;
    const storeA = new PostgresBitrixInstallationRepository(database.dataSource, 'test-portal');
    const storeB = new PostgresBitrixInstallationRepository(database.dataSource, 'test-portal');
    try {
      const installed = await storeA.saveTokens(TOKEN_SET);
      const leaseA = requireLease(
        await storeA.acquireRefreshLock(installed.id, TOKEN_SET.refreshToken, 5),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const leaseB = requireLease(
        await storeB.acquireRefreshLock(installed.id, TOKEN_SET.refreshToken, 30_000),
      );

      await storeA.releaseRefreshLock(leaseA);
      await expect(
        storeB.acquireRefreshLock(installed.id, TOKEN_SET.refreshToken, 30_000),
      ).resolves.toBeNull();
      await expect(
        storeA.replaceTokens(leaseA, TOKEN_SET.refreshToken, {
          ...TOKEN_SET,
          accessToken: 'stale-access',
          refreshToken: 'stale-refresh',
        }),
      ).resolves.toBe(false);

      await storeB.saveTokens({
        ...TOKEN_SET,
        accessToken: 'reinstall-access',
        refreshToken: 'reinstall-refresh',
      });
      await expect(
        storeB.replaceTokens(leaseB, TOKEN_SET.refreshToken, {
          ...TOKEN_SET,
          accessToken: 'late-access',
          refreshToken: 'late-refresh',
        }),
      ).resolves.toBe(false);
      await expect(storeB.findCurrent()).resolves.toMatchObject({
        accessToken: 'reinstall-access',
        refreshToken: 'reinstall-refresh',
      });
    } finally {
      await infrastructure.close();
    }
  });
});
