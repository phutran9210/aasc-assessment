import { Logger } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import {
  describeConnectionUrl,
  safeErrorMessage,
  safeErrorStack,
} from '@common/logging/connection-log.js';
import { elapsedMs, Temporal } from '@common/utils/index.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { TiktokApiModule } from './api.module.js';
import { createTiktokApp } from './bootstrap.js';
import { assertDeploymentIdentity } from './deployment-identity.js';
import { mountOpenApi } from './openapi.js';

const config = validateTiktokEnv(process.env);
const logger = new Logger('TikTokBootstrap');
const app = await createTiktokApp(TiktokApiModule.fromEnvironment());
const dataSource = app.get<DataSource>(getDataSourceToken('tiktok'));
await checkRedisConnection(
  app.get<RedisConnectionFactory>(REDIS_CONNECTION_FACTORY),
  config.redisUrl,
  logger,
);
// Refuse to serve a database that belongs to another advertiser, portal or provider mode.
await assertDeploymentIdentity(dataSource, config);
if (config.swaggerEnabled) mountOpenApi(app);
app.enableShutdownHooks();
await app.listen(config.port, '0.0.0.0');
logger.log(`TikTok integration API listening on port ${config.port}`);

async function checkRedisConnection(
  redis: RedisConnectionFactory,
  redisUrl: string,
  logger: Logger,
): Promise<void> {
  const endpoint = describeConnectionUrl(redisUrl);
  const startedAt = Temporal.Now.instant();
  try {
    const client = await redis.shared();
    const pong = await client.ping();
    logger.log(`Redis connection ready (${endpoint}, PING ${pong}, ${elapsedMs(startedAt)} ms)`);
  } catch (error) {
    logger.error(
      `Redis connection check failed (${endpoint}): ${safeErrorMessage(error)}`,
      safeErrorStack(error),
    );
    throw error;
  }
}
