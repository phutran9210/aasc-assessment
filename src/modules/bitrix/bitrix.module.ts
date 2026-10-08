import { AppConfigModule } from '@config/index.js';
import { bitrixConfig } from '@config/index.js';
import { DatabaseModule } from '@core/database/index.js';

import { Module } from '@nestjs/common';

import { BitrixInstallController } from './controllers/bitrix-install.controller.js';
import { BitrixCoreModule, BITRIX_CONFIG } from './bitrix-core.module.js';
import { BitrixInstallationRepository } from './repositories/bitrix-installation.repository.js';
import { BitrixRateLimiter } from './services/bitrix-rate-limiter.service.js';
import { MemoryOAuthStateStore } from './services/memory-oauth-state-store.js';
import { BITRIX_INSTALLATION_STORE } from './ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from './ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from './ports/bitrix-request-limiter.port.js';

@Module({
  imports: [
    BitrixCoreModule.register({
      imports: [AppConfigModule, DatabaseModule],
      providers: [
        BitrixInstallationRepository,
        BitrixRateLimiter,
        MemoryOAuthStateStore,
        { provide: BITRIX_INSTALLATION_STORE, useExisting: BitrixInstallationRepository },
        { provide: BITRIX_REQUEST_LIMITER, useExisting: BitrixRateLimiter },
        { provide: BITRIX_OAUTH_STATE_STORE, useExisting: MemoryOAuthStateStore },
        {
          provide: BITRIX_CONFIG,
          inject: [bitrixConfig.KEY],
          useFactory: (config: unknown) => config,
        },
      ],
    }),
  ],
  controllers: [BitrixInstallController],
  exports: [BitrixCoreModule],
})
export class BitrixModule {}
