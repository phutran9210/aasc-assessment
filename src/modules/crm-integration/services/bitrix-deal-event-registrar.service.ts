import { Injectable, Logger } from '@nestjs/common';

import { safeErrorMessage } from '@common/logging/connection-log.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { BitrixApiService } from '@modules/bitrix/services/bitrix-api.service.js';
import { BitrixHttpError } from '@modules/bitrix/services/bitrix-http-transport.service.js';

export const BITRIX_DEAL_EVENTS = ['ONCRMDEALADD', 'ONCRMDEALUPDATE', 'ONCRMDEALDELETE'] as const;
export const BITRIX_DEAL_EVENT_PATH = 'webhooks/bitrix24/deals';

export type DealEventRegistration =
  | { status: 'registered'; handler: string }
  | { status: 'skipped'; reason: 'webhook_mode' | 'public_url_missing' }
  | { status: 'failed' };

/**
 * Subscribes the installed OAuth application to the deal events of its portal. With an incoming
 * webhook Bitrix24 refuses `event.bind`; the events then come from an outgoing webhook that an
 * administrator creates on the portal.
 */
@Injectable()
export class BitrixDealEventRegistrar {
  private readonly logger = new Logger(BitrixDealEventRegistrar.name);

  constructor(private readonly api: BitrixApiService) {}

  /**
   * Never throws: a deal that changes without an event is still found by the scheduled poll, so a
   * failed registration must not undo an installation that has already stored its tokens.
   */
  async register(): Promise<DealEventRegistration> {
    if (this.api.mode === 'webhook') return { status: 'skipped', reason: 'webhook_mode' };
    const { publicUrl } = validateTiktokEnv(process.env);
    if (!publicUrl) {
      this.logger.warn('Deal events were not registered: TIKTOK_PUBLIC_URL is not set');
      return { status: 'skipped', reason: 'public_url_missing' };
    }

    const handler = new URL(
      BITRIX_DEAL_EVENT_PATH,
      publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`,
    ).toString();
    try {
      for (const event of BITRIX_DEAL_EVENTS) {
        try {
          await this.api.callRaw('event.bind', { event, handler });
        } catch (error) {
          const bound = error instanceof BitrixHttpError && /already bind/i.test(error.message);
          if (!bound) throw error;
        }
      }
    } catch (error) {
      this.logger.warn(`Deal events were not registered: ${safeErrorMessage(error)}`);
      return { status: 'failed' };
    }
    this.logger.log(`Deal events registered for ${handler}`);
    return { status: 'registered', handler };
  }
}
