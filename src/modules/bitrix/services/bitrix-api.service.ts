import { timingSafeEqual } from 'node:crypto';

import { backoffDelayMs, sleep } from '@common/utils/index.js';
import type { BitrixConfig } from '@config/index.js';

import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { BITRIX_RATE_LIMIT } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import { BITRIX_CONFIG } from '../ports/bitrix-config.port.js';
import { BITRIX_INSTALLATION_STORE } from '../ports/bitrix-installation-store.port.js';
import type { BitrixInstallationStore } from '../ports/bitrix-installation-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '../ports/bitrix-request-limiter.port.js';
import type { BitrixRequestLimiter } from '../ports/bitrix-request-limiter.port.js';
import type { BitrixCallOptions, BitrixResult } from '../types/bitrix-api.types.js';
export type { BitrixCallOptions, BitrixResult } from '../types/bitrix-api.types.js';
import {
  BitrixHttpError,
  BitrixHttpTransport,
  isTransientBitrixError,
} from './bitrix-http-transport.service.js';
import { BitrixOAuthService } from './bitrix-oauth.service.js';

/** Generic gateway to the Bitrix24 REST API used by the feature modules. */
@Injectable()
export class BitrixApiService {
  private readonly logger = new Logger(BitrixApiService.name);

  constructor(
    @Inject(BITRIX_INSTALLATION_STORE)
    private readonly installationRepository: BitrixInstallationStore,
    private readonly oauthService: BitrixOAuthService,
    private readonly transport: BitrixHttpTransport,
    @Inject(BITRIX_REQUEST_LIMITER) private readonly rateLimiter: BitrixRequestLimiter,
    @Inject(BITRIX_CONFIG) private readonly config: Pick<BitrixConfig, 'webhookUrl'>,
  ) {}

  /** `webhook` when BITRIX24_WEBHOOK_URL is set, otherwise the installed OAuth application. */
  get mode(): 'webhook' | 'oauth' {
    return this.config.webhookUrl ? 'webhook' : 'oauth';
  }

  /** Whether a call can be attempted: a webhook URL, or an installed application. */
  async isConfigured(): Promise<boolean> {
    if (this.config.webhookUrl) return true;
    return (await this.installationRepository.findCurrent()) !== null;
  }

  /**
   * Whether `token` is the `application_token` Bitrix24 gave this app at install time. Bitrix24
   * sends it with every event, which is how an event handler knows the caller is the portal.
   */
  async verifyApplicationToken(token: string): Promise<boolean> {
    const expected = (await this.installationRepository.findCurrent())?.applicationToken;
    if (!expected || !token) return false;
    const left = Buffer.from(token);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

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
    try {
      return await this.callRaw<T>(method, payload);
    } catch (error) {
      throw this.mapError(method, error);
    }
  }

  /**
   * Same call, for callers that react to the Bitrix24 error themselves: a failure is thrown as
   * the original BitrixHttpError (code, status, timeout flag), not as an HTTP error. In webhook
   * mode the URL carries the credentials, so there is no token to send or refresh.
   */
  async callRaw<T>(
    method: string,
    payload: Record<string, unknown>,
    options: BitrixCallOptions = {},
  ): Promise<BitrixResult<T>> {
    if (this.config.webhookUrl) {
      return this.callWithinRateLimit<T>(
        this.config.webhookUrl,
        method,
        payload,
        undefined,
        options,
      );
    }

    const installation = await this.installationRepository.findCurrent();
    if (!installation) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.NOT_INSTALLED);
    }

    const endpoint = installation.clientEndpoint;
    const accessToken = await this.oauthService.getAccessToken();
    try {
      return await this.callWithinRateLimit<T>(endpoint, method, payload, accessToken, options);
    } catch (error) {
      if (!(error instanceof BitrixHttpError) || !this.isExpiredToken(error)) throw error;
      const refreshedToken = await this.oauthService.refreshAccessToken(accessToken);
      return this.callWithinRateLimit<T>(endpoint, method, payload, refreshedToken, options);
    }
  }

  /**
   * Sends one call through the client-side rate limiter. If Bitrix24 still answers
   * QUERY_LIMIT_EXCEEDED (another process or integration used the budget), back off and retry:
   * a rate-limited request was not executed, so repeating it is always safe. Timeouts, network
   * failures and 5xx are retried only when the caller asked for it.
   */
  private async callWithinRateLimit<T>(
    endpoint: string,
    method: string,
    payload: Record<string, unknown>,
    token: string | undefined,
    options: BitrixCallOptions,
  ): Promise<BitrixResult<T>> {
    for (let attempt = 0; ; attempt++) {
      await this.rateLimiter.acquire();
      try {
        return await this.call<T>(endpoint, method, payload, token, options.timeoutMs);
      } catch (error) {
        const limited = this.isRateLimited(error);
        if (limited) await this.rateLimiter.saturate();

        if (limited && options.retryRateLimit === false) throw error;

        const transient = !limited && options.retryTransient && isTransientBitrixError(error);
        if (!limited && !transient) throw error;

        const retries = limited
          ? BITRIX_RATE_LIMIT.RETRIES
          : (options.maxRetries ?? BITRIX_RATE_LIMIT.RETRIES);
        if (attempt >= retries) throw error;

        const delayMs = limited
          ? BITRIX_RATE_LIMIT.BASE_DELAY_MS * 2 ** attempt
          : backoffDelayMs(attempt, BITRIX_RATE_LIMIT.BASE_DELAY_MS);
        this.logger.warn(
          limited
            ? `${method} rate limited by Bitrix24, retrying in ${delayMs}ms`
            : `${method} failed temporarily, retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
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
    token: string | undefined,
    timeoutMs: number | undefined,
  ): Promise<BitrixResult<T>> {
    const response = await this.transport.postRest<{ result?: T; total?: number }>(
      endpoint,
      method,
      payload,
      token,
      timeoutMs,
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
