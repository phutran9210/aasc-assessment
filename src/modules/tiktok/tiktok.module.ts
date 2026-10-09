import { Module } from '@nestjs/common';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { QueueModule } from '@core/queue/queue.module.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { TiktokWebhookController } from './controllers/tiktok-webhook.controller.js';
import { TiktokSignatureGuard } from './guards/tiktok-signature.guard.js';
import { WebhookAdvertiserLimitGuard } from './guards/webhook-advertiser-limit.guard.js';
import { TIKTOK_WEBHOOK_CONFIG } from './constants/index.js';
import { TiktokInboxService } from './services/tiktok-inbox.service.js';
import { ConfigurationPersistenceModule } from '@modules/crm-integration/index.js';

@Module({
  imports: [TiktokDatabaseModule, ConfigurationPersistenceModule, QueueModule],
  controllers: [TiktokWebhookController],
  providers: [
    { provide: TIKTOK_WEBHOOK_CONFIG, useFactory: () => validateTiktokEnv(process.env) },
    TiktokSignatureGuard,
    WebhookAdvertiserLimitGuard,
    TiktokInboxService,
  ],
  exports: [TiktokInboxService],
})
export class TiktokModule {}
