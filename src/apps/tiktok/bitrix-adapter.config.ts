import type { DynamicModule } from '@nestjs/common';

import type { BitrixConfig } from '@config/bitrix.config.js';
import { BitrixAdapterModule } from '@modules/crm-integration/bitrix-adapter.module.js';

/** Bitrix24 adapter of this deployment, built from the environment for both API and worker. */
export function environmentBitrixAdapter(): DynamicModule {
  const portalKey = process.env.BITRIX_PORTAL_KEY ?? 'mock-portal';
  const requisitePresetId = Number(process.env.BITRIX24_REQUISITE_PRESET_ID ?? 0);
  const bitrix: BitrixConfig = {
    clientId: process.env.BITRIX24_CLIENT_ID ?? '',
    clientSecret: process.env.BITRIX24_CLIENT_SECRET ?? '',
    portalDomain: process.env.BITRIX24_DOMAIN ?? '',
    requisitePresetId:
      Number.isSafeInteger(requisitePresetId) && requisitePresetId >= 0 ? requisitePresetId : 0,
    webhookUrl: process.env.BITRIX24_WEBHOOK_URL,
    timeoutMs: 10_000,
    stateTtlSeconds: 600,
    refreshSkewSeconds: 60,
  };
  return BitrixAdapterModule.register({
    portalKey,
    namespace: `aasc-tiktok:${portalKey}`,
    bitrix,
  });
}
