import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';

import { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';

describe('TikTok Redis and isolated test infrastructure', () => {
  it('isolates queues and schemas between harnesses and preserves unrelated Redis keys', async () => {
    const [first, second] = await Promise.all([
      createTestInfrastructure(),
      createTestInfrastructure(),
    ]);
    const outsideKey = `unrelated:${randomUUID()}`;
    const outsideRedis = second.redis.producer();
    const firstQueue = new Queue('isolation-check', {
      connection: first.redis.producer(),
      prefix: first.redisPrefix,
    });
    const secondQueue = new Queue('isolation-check', {
      connection: second.redis.producer(),
      prefix: second.redisPrefix,
    });

    try {
      await outsideRedis.connect();
      await outsideRedis.set(outsideKey, 'preserve');
      await firstQueue.add(
        'same-business-key',
        { key: 'same-business-key' },
        { jobId: 'same-key' },
      );
      expect(await firstQueue.getJob('same-key')).not.toBeNull();
      expect(await secondQueue.getJob('same-key')).toBeFalsy();

      for (const database of [first.database, second.database]) {
        await database.dataSource.query(
          `CREATE TABLE "${database.schema}".harness_probe (business_key text PRIMARY KEY)`,
        );
        await database.dataSource.query(
          `INSERT INTO "${database.schema}".harness_probe (business_key) VALUES ('same-business-key')`,
        );
      }
      await firstQueue.close();
      await first.close();
      const secondRows = await second.database.dataSource.query<{ business_key: string }[]>(
        `SELECT business_key FROM "${second.database.schema}".harness_probe`,
      );
      expect(secondRows).toEqual([{ business_key: 'same-business-key' }]);
      expect(await outsideRedis.get(outsideKey)).toBe('preserve');
      await outsideRedis.del(outsideKey);
    } finally {
      await secondQueue.close();
      await first.close();
      await second.close();
    }
  });

  it('fails producer commands quickly when Redis is unavailable', async () => {
    const redis = new RedisConnectionFactory('redis://127.0.0.1:1', 'test-unavailable').producer();
    const startedAt = Date.now();
    try {
      await expect(redis.connect().then(() => redis.ping())).rejects.toThrow();
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    } finally {
      redis.disconnect();
    }
  });
});
