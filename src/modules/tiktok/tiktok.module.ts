import { Module } from '@nestjs/common';

import { TiktokDatabaseModule } from '@/apps/tiktok/database/database.module.js';
import { QueueModule } from '@core/queue/queue.module.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { TiktokWebhookController } from './controllers/tiktok-webhook.controller.js';
import { TiktokSignatureGuard, TIKTOK_WEBHOOK_CONFIG } from './guards/tiktok-signature.guard.js';
import { TiktokInboxService } from './services/tiktok-inbox.service.js';

@Module({
  imports: [TiktokDatabaseModule, QueueModule],
  controllers: [TiktokWebhookController],
  providers: [
    { provide: TIKTOK_WEBHOOK_CONFIG, useFactory: () => validateTiktokEnv(process.env) },
    TiktokSignatureGuard,
    TiktokInboxService,
  ],
  exports: [TiktokInboxService],
})
export class TiktokModule {}
