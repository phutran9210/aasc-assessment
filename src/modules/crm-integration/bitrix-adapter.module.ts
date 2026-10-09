import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';

import { TiktokRedisModule } from '@core/queue/redis.module.js';
import { REDIS_CONNECTION_FACTORY } from '@config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import type { BitrixConfig } from '@config/bitrix.config.js';
// Deep imports on purpose: the package index also exports the legacy SQLite module, whose
// import would load the old application's configuration into this app.
import { BitrixCoreModule, BITRIX_CONFIG } from '@modules/bitrix/bitrix-core.module.js';
import { BITRIX_INSTALLATION_STORE } from '@modules/bitrix/ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '@modules/bitrix/ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '@modules/bitrix/ports/bitrix-request-limiter.port.js';
import { BitrixInstallationEntity } from './entities/bitrix-installation.entity.js';
import { TiktokBitrixInstallController } from './controllers/bitrix-install.controller.js';
import {
  RedisBitrixLimiter,
  type RedisBitrixLimiterOptions,
} from './gateways/redis-bitrix-limiter.js';
import { RedactedBitrixLogger } from './gateways/redacted-bitrix-logger.js';
import { RedisOAuthStateStore } from './gateways/redis-oauth-state-store.js';
import { BITRIX_LOGGER } from '@modules/bitrix/ports/bitrix-logger.port.js';
import { PostgresBitrixInstallationRepository } from './repositories/postgres-bitrix-installation.repository.js';
import { IntegrationAuthModule } from '@modules/integration-auth/index.js';
import { BITRIX_ADAPTER_CONFIG, BITRIX_REDIS_CLIENT } from './tokens.js';

export type BitrixAdapterConfig = {
  portalKey: string;
  namespace: string;
  bitrix: BitrixConfig;
  limiter?: RedisBitrixLimiterOptions;
};

export function createBitrixAdapterProviders(config: BitrixAdapterConfig): Provider[] {
  return [
    { provide: BITRIX_CONFIG, useValue: config.bitrix },
    { provide: BITRIX_LOGGER, useFactory: () => new RedactedBitrixLogger() },
    {
      provide: BITRIX_REDIS_CLIENT,
      inject: [REDIS_CONNECTION_FACTORY],
      useFactory: (factory: RedisConnectionFactory): Redis => factory.producer(),
    },
    {
      provide: PostgresBitrixInstallationRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) =>
        new PostgresBitrixInstallationRepository(dataSource, config.portalKey),
    },
    {
      provide: RedisOAuthStateStore,
      inject: [BITRIX_REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisOAuthStateStore(redis, config.namespace),
    },
    {
      provide: RedisBitrixLimiter,
      inject: [BITRIX_REDIS_CLIENT],
      useFactory: (redis: Redis) =>
        new RedisBitrixLimiter(redis, config.namespace, config.portalKey, config.limiter),
    },
    {
      provide: BITRIX_INSTALLATION_STORE,
      useExisting: PostgresBitrixInstallationRepository,
    },
    { provide: BITRIX_OAUTH_STATE_STORE, useExisting: RedisOAuthStateStore },
    { provide: BITRIX_REQUEST_LIMITER, useExisting: RedisBitrixLimiter },
  ];
}

@Module({})
export class BitrixAdapterModule {
  static register(config: BitrixAdapterConfig): DynamicModule {
    return {
      module: BitrixAdapterModule,
      imports: [
        IntegrationAuthModule,
        BitrixCoreModule.register({
          imports: [TiktokRedisModule],
          providers: createBitrixAdapterProviders(config),
        }),
      ],
      controllers: [TiktokBitrixInstallController],
      providers: [{ provide: BITRIX_ADAPTER_CONFIG, useValue: config.bitrix }],
      exports: [BitrixCoreModule],
    };
  }
}

export { BitrixInstallationEntity };
