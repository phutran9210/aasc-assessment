import { Global, Module } from '@nestjs/common';

import { REDIS_CONNECTION_FACTORY } from '../../config/tiktok-app/redis.config.js';
import { validateTiktokEnv } from '../../config/tiktok-app/env.validation.js';
import { RedisConnectionFactory } from './redis-connection.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION_FACTORY,
      useFactory: () => {
        const config = validateTiktokEnv(process.env);
        return new RedisConnectionFactory(config.redisUrl, config.queuePrefix);
      },
    },
  ],
  exports: [REDIS_CONNECTION_FACTORY],
})
export class TiktokRedisModule {}
