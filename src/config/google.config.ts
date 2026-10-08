import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const googleConfig = registerAs('google', () => {
  const env = validateEnv(process.env);

  return {
    authMode: env.GOOGLE_AUTH_MODE,
    serviceAccountKeyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    serviceAccountKeyBase64: env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64,
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    sheetId: env.GOOGLE_SHEET_ID,
    sheetName: env.GOOGLE_SHEET_NAME,
    timeoutMs: 30_000,
    maxRetries: env.LEAD_SYNC_MAX_RETRIES,
    retryBaseDelayMs: 500,
  };
});

export type GoogleConfig = ConfigType<typeof googleConfig>;
