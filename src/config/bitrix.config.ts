import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const bitrixConfig = registerAs('bitrix', () => {
  const env = validateEnv(process.env);

  return {
    clientId: env.BITRIX24_CLIENT_ID,
    clientSecret: env.BITRIX24_CLIENT_SECRET,
    portalDomain: env.BITRIX24_DOMAIN,
    requisitePresetId: env.BITRIX24_REQUISITE_PRESET_ID,
    webhookUrl: env.BITRIX24_WEBHOOK_URL,
    timeoutMs: 10_000,
    stateTtlSeconds: 600,
    refreshSkewSeconds: 60,
  };
});

export type BitrixConfig = ConfigType<typeof bitrixConfig>;
