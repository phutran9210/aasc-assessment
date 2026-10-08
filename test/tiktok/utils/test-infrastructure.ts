import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { createTestDatabase } from './test-database.js';

export type TestInfrastructure = {
  database: Awaited<ReturnType<typeof createTestDatabase>>;
  redis: RedisConnectionFactory;
  redisPrefix: string;
  close(): Promise<void>;
};

export async function createTestInfrastructure(): Promise<TestInfrastructure> {
  const databaseUrl = process.env.TIKTOK_TEST_DATABASE_URL;
  const redisUrl = process.env.TIKTOK_TEST_REDIS_URL;
  if (!databaseUrl) throw new Error('TIKTOK_TEST_DATABASE_URL is required');
  if (!redisUrl) throw new Error('TIKTOK_TEST_REDIS_URL is required');

  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (databaseName !== 'tiktok_test') {
    throw new Error('Integration harness only supports the dedicated tiktok_test database');
  }

  const database = await createTestDatabase();
  const redisPrefix = `aasc-tiktok-test-${randomUUID()}`;
  const redis = new RedisConnectionFactory(redisUrl, redisPrefix);
  const probe = redis.producer();
  let isClosed = false;

  try {
    await database.dataSource.runMigrations({ transaction: 'all' });
    await probe.connect();
    await probe.ping();
  } catch (error) {
    await redis.closeAll();
    await database.close();
    throw error;
  }

  return {
    database,
    redis,
    redisPrefix,
    async close() {
      if (isClosed) return;
      isClosed = true;
      const cleanup = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        retryStrategy: (attempt) => (attempt > 3 ? null : 100),
      });
      try {
        await cleanup.connect();
        let cursor = '0';
        do {
          const [nextCursor, keys] = await cleanup.scan(
            cursor,
            'MATCH',
            `${redisPrefix}:*`,
            'COUNT',
            100,
          );
          cursor = nextCursor;
          if (keys.length) await cleanup.del(...keys);
        } while (cursor !== '0');
      } finally {
        if (cleanup.status === 'ready') await cleanup.quit();
        else cleanup.disconnect();
        await redis.closeAll();
        await database.close();
      }
    },
  };
}
