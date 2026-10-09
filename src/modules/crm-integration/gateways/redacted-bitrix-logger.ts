import { IntegrationLogger } from '@common/logging/integration-logger.js';
import type { BitrixLogDetail, BitrixLogger } from '@modules/bitrix/ports/bitrix-logger.port.js';

/** Bitrix core logger of the TikTok app: structured and redacted like every other log line. */
export class RedactedBitrixLogger implements BitrixLogger {
  private readonly logger = new IntegrationLogger('Bitrix');

  warn(message: string, detail: BitrixLogDetail = {}): void {
    this.logger.warn('bitrix.call_retry', { message, ...detail });
  }

  error(message: string, detail: BitrixLogDetail = {}): void {
    this.logger.error('bitrix.call_failed', { message, ...detail });
  }
}
