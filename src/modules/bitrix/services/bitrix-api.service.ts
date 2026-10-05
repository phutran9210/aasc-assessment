import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { BITRIX_RATE_LIMIT } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import { BitrixInstallationRepository } from '../repositories/bitrix-installation.repository.js';
import { BitrixHttpError, BitrixHttpTransport } from './bitrix-http-transport.service.js';
import { BitrixOAuthService } from './bitrix-oauth.service.js';
import { BitrixRateLimiter } from './bitrix-rate-limiter.service.js';

type BitrixResult<T> = { result: T; total?: number };

/** Generic gateway to the Bitrix24 REST API used by the feature modules. */
@Injectable()
export class BitrixApiService {
  private readonly logger = new Logger(BitrixApiService.name);

  constructor(
    private readonly installationRepository: BitrixInstallationRepository,
    private readonly oauthService: BitrixOAuthService,
    private readonly transport: BitrixHttpTransport,
    private readonly rateLimiter: BitrixRateLimiter,
  ) {}

  /**
   * Calls one Bitrix24 REST method (for example `crm.item.list`) with the current access token
   * and returns its `result`. A rejected token is refreshed once and the call repeated; every
   * other failure is logged and mapped to an HTTP error (404, 429, 502 or 504).
   */
  async callBitrixApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    return (await this.callBitrixApiWithTotal<T>(method, payload)).result;
  }

  /** Same as callBitrixApi, but keeps `total`, which list methods return next to `result`. */
  async callBitrixApiWithTotal<T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<BitrixResult<T>> {
    const installation = await this.installationRepository.findCurrent();
    if (!installation) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.NOT_INSTALLED);
    }

    const accessToken = await this.oauthService.getAccessToken();
    try {
      return await this.callWithinRateLimit<T>(
        installation.clientEndpoint,
        method,
        payload,
        accessToken,
      );
    } catch (error) {
      if (!(error instanceof BitrixHttpError) || !this.isExpiredToken(error)) {
        throw this.mapError(method, error);
      }
      const refreshedToken = await this.oauthService.refreshAccessToken(accessToken);
      try {
        return await this.callWithinRateLimit<T>(
          installation.clientEndpoint,
          method,
          payload,
          refreshedToken,
        );
      } catch (retryError) {
        throw this.mapError(method, retryError);
      }
    }
  }

  /**
   * Sends one call through the client-side rate limiter. If Bitrix24 still answers
   * QUERY_LIMIT_EXCEEDED (another process or integration used the budget), back off and retry.
   */
  private async callWithinRateLimit<T>(
    endpoint: string,
    method: string,
    payload: Record<string, unknown>,
    token: string,
  ): Promise<BitrixResult<T>> {
    for (let attempt = 0; ; attempt++) {
      await this.rateLimiter.acquire();
      try {
        return await this.call<T>(endpoint, method, payload, token);
      } catch (error) {
        if (!this.isRateLimited(error)) throw error;
        this.rateLimiter.saturate();
        if (attempt >= BITRIX_RATE_LIMIT.RETRIES) throw error;
        const delayMs = BITRIX_RATE_LIMIT.BASE_DELAY_MS * 2 ** attempt;
        this.logger.warn(`${method} rate limited by Bitrix24, retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private isRateLimited(error: unknown): boolean {
    return error instanceof BitrixHttpError && error.code === BITRIX_RATE_LIMIT.ERROR_CODE;
  }

  private async call<T>(
    endpoint: string,
    method: string,
    payload: Record<string, unknown>,
    token: string,
  ): Promise<BitrixResult<T>> {
    const response = await this.transport.postRest<{ result?: T; total?: number }>(
      endpoint,
      method,
      payload,
      token,
    );
    if (response.result === undefined) {
      throw new BitrixHttpError(BITRIX_MESSAGES.ERROR.RESULT_MISSING, 'INVALID_RESPONSE', 502);
    }
    return { result: response.result, total: response.total };
  }

  private isExpiredToken(error: BitrixHttpError): boolean {
    // Bitrix24 reports these codes in mixed case (`expired_token`, `invalid_token`, `NO_AUTH_FOUND`).
    return ['expired_token', 'invalid_token', 'no_auth_found'].includes(
      (error.code ?? '').toLowerCase(),
    );
  }

  private mapError(method: string, error: unknown): Error {
    // Already an HTTP error of ours (gateway errors, 429 from the rate limiter).
    if (error instanceof HttpException) return error;
    if (this.isRateLimited(error)) {
      this.logger.error(`${method} failed: Bitrix24 rate limit still exceeded after retries`);
      return new HttpException(BITRIX_MESSAGES.ERROR.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }
    // crm.item.get/update/delete answer NOT_FOUND for a missing item instead of an empty result.
    if (error instanceof BitrixHttpError && error.code === 'NOT_FOUND') {
      return new NotFoundException(BITRIX_MESSAGES.ERROR.NOT_FOUND);
    }
    // Log the upstream reason; the client only receives a generic gateway error.
    if (error instanceof BitrixHttpError) {
      this.logger.error(
        `${method} failed: ${error.message} (code=${error.code ?? '-'}, status=${error.status ?? '-'})`,
      );
    } else {
      this.logger.error(
        `${method} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (error instanceof BitrixHttpError && error.timeout) {
      return new GatewayTimeoutException(BITRIX_MESSAGES.ERROR.TIMEOUT);
    }
    return new BadGatewayException(BITRIX_MESSAGES.ERROR.REQUEST_FAILED);
  }
}
