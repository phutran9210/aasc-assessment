import { AppConfigModule } from '@config/index.js';
import { DatabaseModule } from '@core/database/index.js';

import { Module } from '@nestjs/common';

import { BitrixInstallController } from './controllers/bitrix-install.controller.js';
import { BitrixInstallationRepository } from './repositories/bitrix-installation.repository.js';
import { BitrixApiService } from './services/bitrix-api.service.js';
import { BitrixBatchService } from './services/bitrix-batch.service.js';
import { BitrixHttpTransport } from './services/bitrix-http-transport.service.js';
import { BitrixOAuthService } from './services/bitrix-oauth.service.js';
import { BitrixRateLimiter } from './services/bitrix-rate-limiter.service.js';

@Module({
  imports: [AppConfigModule, DatabaseModule],
  controllers: [BitrixInstallController],
  providers: [
    BitrixInstallationRepository,
    BitrixHttpTransport,
    BitrixRateLimiter,
    BitrixOAuthService,
    BitrixApiService,
    BitrixBatchService,
  ],
  exports: [BitrixApiService, BitrixBatchService],
})
export class BitrixModule {}
