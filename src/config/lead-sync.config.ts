import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const leadSyncConfig = registerAs('leadSync', () => {
  const env = validateEnv(process.env);

  return {
    mappingPath: env.LEAD_SYNC_MAPPING_PATH,
    cron: env.LEAD_SYNC_CRON,
    timezone: env.LEAD_SYNC_TIMEZONE,
    direction: env.LEAD_SYNC_DIRECTION,
    defaultCountry: env.LEAD_SYNC_DEFAULT_COUNTRY,
    maxRetries: env.LEAD_SYNC_MAX_RETRIES,
    logRetentionDays: env.LEAD_SYNC_LOG_RETENTION_DAYS,
    // 25 rows × 2 dedupe values = 50 commands, the limit of one Bitrix24 batch.
    batchSize: 25,
    retryBaseDelayMs: 500,
    // A run whose heartbeat is older than this is considered dead and may be taken over.
    lockStaleMs: 120_000,
    // Public base URL of this app (for example the ngrok URL): where Bitrix24 sends lead events.
    publicUrl: env.APP_PUBLIC_URL,
    // `application_token` of an outbound webhook created by hand, when the app is not installed.
    outgoingToken: env.BITRIX24_OUTGOING_TOKEN,
    // Events of the same few seconds are pulled together in one run.
    eventDebounceMs: 2000,
    eventRetryMs: 5000,
  };
});

export type LeadSyncConfig = ConfigType<typeof leadSyncConfig>;
