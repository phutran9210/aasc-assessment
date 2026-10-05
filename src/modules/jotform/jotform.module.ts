import { AppConfigModule } from '@config/index.js';
import { DatabaseModule } from '@core/database/index.js';
import { ContactModule } from '@modules/contact/index.js';

import { Module } from '@nestjs/common';

import { JotformController } from './controllers/jotform.controller.js';
import { JotformWebhookSecretGuard } from './guards/jotform-webhook-secret.guard.js';
import { JotformSubmissionRepository } from './repositories/jotform-submission.repository.js';
import { JotformApiService } from './services/jotform-api.service.js';
import { JotformSyncService } from './services/jotform-sync.service.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, ContactModule],
  controllers: [JotformController],
  providers: [
    JotformApiService,
    JotformSubmissionRepository,
    JotformSyncService,
    JotformWebhookSecretGuard,
  ],
})
export class JotformModule {}
