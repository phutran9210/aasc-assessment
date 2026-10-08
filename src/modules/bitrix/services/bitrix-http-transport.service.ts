import type { BitrixConfig } from '@config/index.js';

import { Inject, Injectable } from '@nestjs/common';

import { BITRIX_TIME_LIMIT_ERROR } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import { BITRIX_CONFIG } from '../ports/bitrix-config.port.js';
import type { BitrixRestEnvelope } from '../types/index.js';

/** A failed Bitrix24 call: carries the Bitrix error code, the HTTP status and a timeout flag. */
export class BitrixHttpError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number | undefined,
    readonly timeout = false,
  ) {
    super(message);
    this.name = 'BitrixHttpError';
  }
}

/**
 * True for failures that say nothing about the request itself: a timeout, a network error or a
 * 5xx answer. The same request may succeed if sent again, but it may also have been executed.
 */
export function isTransientBitrixError(error: unknown): boolean {
  if (!(error instanceof BitrixHttpError)) return false;
  if (error.code === BITRIX_TIME_LIMIT_ERROR) return false;
  if (error.timeout || error.status === undefined) return true;
  return error.status >= 500;
}

/**
 * The only place that talks HTTP to Bitrix24. Applies the timeout and turns every failure
 * (network, timeout, non-JSON body, 4xx/5xx, `error` in the body) into a BitrixHttpError.
 */
@Injectable()
export class BitrixHttpTransport {
  constructor(@Inject(BITRIX_CONFIG) private readonly config: BitrixConfig) {}

  /** GET used for the token endpoint of the authorization server. */
  async getJson<T>(url: string): Promise<T> {
    return this.request<T>(url, undefined);
  }

  /** POST of one REST method to the portal; the access token travels in the `auth` field. */
  async postRest<T>(
    endpoint: string,
    method: string,
    payload: Record<string, unknown>,
    accessToken?: string,
    timeoutMs?: number,
  ): Promise<T> {
    const body = accessToken ? { ...payload, auth: accessToken } : payload;
    return this.request<T>(
      `${endpoint.replace(/\/$/, '')}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private async request<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs ?? this.config.timeoutMs),
      });
      const raw = await response.text();
      let parsed: BitrixRestEnvelope<T>;
      try {
        parsed = raw ? (JSON.parse(raw) as BitrixRestEnvelope<T>) : {};
      } catch {
        throw new BitrixHttpError(
          BITRIX_MESSAGES.ERROR.RESPONSE_INVALID,
          undefined,
          response.status,
        );
      }
      if (!response.ok || parsed.error) {
        throw new BitrixHttpError(
          parsed.error_description ?? `Bitrix24 HTTP ${response.status}`,
          parsed.error,
          response.status,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof BitrixHttpError) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new BitrixHttpError(BITRIX_MESSAGES.ERROR.TIMEOUT, undefined, undefined, true);
      }
      throw new BitrixHttpError(BITRIX_MESSAGES.ERROR.UNREACHABLE, undefined, undefined);
    }
  }
}
