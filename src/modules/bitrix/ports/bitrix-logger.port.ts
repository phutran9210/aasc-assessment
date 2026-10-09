import { Logger } from '@nestjs/common';

export type BitrixLogDetail = {
  /** Upstream explanation, already stripped of credentials and contact data by the caller. */
  reason?: string;
  errorCode?: string;
  status?: number;
  delayMs?: number;
};

/**
 * Logging port of the shared Bitrix24 core. The core never hands a raw upstream error to a
 * logger: it passes a short message plus this sanitized detail, and each application decides how
 * to write it.
 */
export type BitrixLogger = {
  warn(message: string, detail?: BitrixLogDetail): void;
  error(message: string, detail?: BitrixLogDetail): void;
};

export const BITRIX_LOGGER = Symbol('BITRIX_LOGGER');

/** Default for applications that do not provide their own logger: a plain Nest logger line. */
export class NestBitrixLogger implements BitrixLogger {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  warn(message: string, detail?: BitrixLogDetail): void {
    this.logger.warn(format(message, detail));
  }

  error(message: string, detail?: BitrixLogDetail): void {
    this.logger.error(format(message, detail));
  }
}

function format(message: string, detail?: BitrixLogDetail): string {
  if (!detail) return message;
  const reason = detail.reason ? `: ${detail.reason}` : '';
  const extras = [
    detail.errorCode !== undefined ? `errorCode=${detail.errorCode}` : null,
    detail.status !== undefined ? `status=${detail.status}` : null,
    detail.delayMs !== undefined ? `delayMs=${detail.delayMs}` : null,
  ].filter(Boolean);
  return `${message}${reason}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}
