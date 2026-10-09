import { Global, Module } from '@nestjs/common';

import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { RedisConnectionFactory } from './redis-connection.js';
import { INGRESS_LIMIT_OPTIONS } from './guards/ingress-rate-limit.guard.js';
import type { IngressLimitOptions } from './guards/ingress-rate-limit.guard.js';
import {
  LOCAL_RATE_LIMITER,
  LocalRateLimiter,
  RATE_LIMITER,
  RedisRateLimiter,
} from './services/rate-limiter.service.js';

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
    {
      provide: RATE_LIMITER,
      inject: [REDIS_CONNECTION_FACTORY],
      useFactory: (redis: RedisConnectionFactory) => new RedisRateLimiter(redis),
    },
    { provide: LOCAL_RATE_LIMITER, useFactory: () => new LocalRateLimiter() },
    {
      provide: INGRESS_LIMIT_OPTIONS,
      useFactory: (): IngressLimitOptions => {
        const config = validateTiktokEnv(process.env);
        return {
          trustedProxies: config.trustedProxies,
          limit: config.ingressIpLimit,
          advertiserLimit: config.webhookAdvertiserLimit,
        };
      },
    },
  ],
  exports: [REDIS_CONNECTION_FACTORY, RATE_LIMITER, LOCAL_RATE_LIMITER, INGRESS_LIMIT_OPTIONS],
})
export class TiktokRedisModule {}
