import { AppConfigModule } from '@config/index.js';

import { Module } from '@nestjs/common';

import { GoogleOAuthController } from './controllers/google-oauth.controller.js';
import { GoogleAuthProvider } from './services/google-auth.provider.js';
import { GoogleOAuthService } from './services/google-oauth.service.js';
import { SheetsClient } from './services/sheets-client.service.js';
import { SheetsRateLimiter } from './services/sheets-rate-limiter.service.js';

@Module({
  imports: [AppConfigModule],
  controllers: [GoogleOAuthController],
  providers: [GoogleAuthProvider, GoogleOAuthService, SheetsRateLimiter, SheetsClient],
  exports: [GoogleAuthProvider, SheetsClient],
})
export class GoogleSheetsModule {}
