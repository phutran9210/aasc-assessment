import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import { TiktokRedisModule } from '@core/queue/redis.module.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import type { IntegrationAuthConfig } from './types/index.js';
import { AuthController } from './controllers/auth.controller.js';
import { IntegrationUserRepository } from './repositories/integration-user.repository.js';
import { IntegrationAuthService } from './services/integration-auth.service.js';
import { INTEGRATION_AUTH_CONFIG } from './constants/index.js';
import { SessionService } from './services/session.service.js';
import { IntegrationJwtGuard } from './guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from './guards/roles.guard.js';
import { IntegrationRateLimitGuard } from './guards/integration-rate-limit.guard.js';
import { LOCAL_RATE_LIMITER, RATE_LIMITER } from '@core/queue/services/rate-limiter.service.js';
import type { LocalRateLimiter, RateLimiter } from '@core/queue/services/rate-limiter.service.js';

@Module({
  imports: [
    TiktokRedisModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const config = validateTiktokEnv(process.env);
        return {
          secret: config.jwtSecret,
          signOptions: {
            issuer: config.jwtIssuer,
            audience: config.jwtAudience,
            expiresIn: config.jwtTtlSeconds,
            algorithm: 'HS256',
          },
          verifyOptions: {
            issuer: config.jwtIssuer,
            audience: config.jwtAudience,
            algorithms: ['HS256'],
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: INTEGRATION_AUTH_CONFIG,
      useFactory: () => validateTiktokEnv(process.env),
    },
    {
      provide: IntegrationUserRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new IntegrationUserRepository(dataSource),
    },
    {
      provide: SessionService,
      inject: [REDIS_CONNECTION_FACTORY, INTEGRATION_AUTH_CONFIG],
      useFactory: (factory: RedisConnectionFactory, config: IntegrationAuthConfig) =>
        new SessionService(factory.producer(), config.queuePrefix),
    },
    IntegrationAuthService,
    {
      provide: IntegrationRateLimitGuard,
      inject: [RATE_LIMITER, LOCAL_RATE_LIMITER],
      useFactory: (limiter: RateLimiter, local: LocalRateLimiter) =>
        new IntegrationRateLimitGuard(limiter, local),
    },
    IntegrationJwtGuard,
    IntegrationRolesGuard,
  ],
  exports: [
    IntegrationAuthService,
    IntegrationJwtGuard,
    IntegrationRolesGuard,
    IntegrationRateLimitGuard,
    IntegrationUserRepository,
    SessionService,
  ],
})
export class IntegrationAuthModule {}
