import { AppConfigModule } from '@config/index.js';

import { Module } from '@nestjs/common';

import { GoogleAuthProvider } from './services/google-auth.provider.js';
import { SheetsClient } from './services/sheets-client.service.js';
import { SheetsRateLimiter } from './services/sheets-rate-limiter.service.js';

@Module({
  imports: [AppConfigModule],
  providers: [GoogleAuthProvider, SheetsRateLimiter, SheetsClient],
  exports: [GoogleAuthProvider, SheetsClient],
})
export class GoogleSheetsModule {}
