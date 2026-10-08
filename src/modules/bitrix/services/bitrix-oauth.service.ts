import type { BitrixConfig } from '@config/index.js';
import { Temporal, nowIso, nowMs } from '@common/utils/index.js';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';

import { BITRIX_EVENT_NAMES, BITRIX_REFRESH_LOCK, BITRIX_REST } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import { BITRIX_CONFIG } from '../ports/bitrix-config.port.js';
import { BITRIX_INSTALLATION_STORE } from '../ports/bitrix-installation-store.port.js';
import type { BitrixInstallationStore } from '../ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '../ports/bitrix-oauth-state-store.port.js';
import type { OAuthStateStore } from '../ports/bitrix-oauth-state-store.port.js';
import type {
  BitrixInstallationSnapshot,
  RefreshLease,
} from '../types/bitrix-installation-snapshot.type.js';
import { BitrixHttpError, BitrixHttpTransport } from './bitrix-http-transport.service.js';
import type { BitrixInstallEvent, BitrixRestEnvelope, BitrixTokenSet } from '../types/index.js';
import {
  normalizeInstallPayload,
  validateBitrixInstallEvent,
} from '../utils/normalize-install-payload.js';

type OAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  domain: string;
  member_id: string;
  scope: string;
  status: string;
  client_endpoint: string;
  server_endpoint: string;
};

/** Obtains, stores and refreshes the OAuth 2.0 token pair of the installed application. */
@Injectable()
export class BitrixOAuthService {
  private refreshPromise: Promise<string> | undefined;

  constructor(
    private readonly transport: BitrixHttpTransport,
    @Inject(BITRIX_INSTALLATION_STORE) private readonly repository: BitrixInstallationStore,
    @Inject(BITRIX_OAUTH_STATE_STORE) private readonly stateStore: OAuthStateStore,
    @Inject(BITRIX_CONFIG) private readonly config: BitrixConfig,
  ) {}

  /**
   * Stores the tokens delivered by an install event. The access token is first used to call
   * `app.info`, which proves the event really comes from the portal of this application.
   */
  async handleInstallEvent(event: BitrixInstallEvent): Promise<void> {
    if (!BITRIX_EVENT_NAMES.includes(event.event as (typeof BITRIX_EVENT_NAMES)[number])) {
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.EVENT_UNSUPPORTED);
    }
    this.validateAuth(event.auth);
    const appInfo = await this.transport.postRest<BitrixRestEnvelope<{ CODE?: string }>>(
      event.auth.client_endpoint,
      'app.info',
      {},
      event.auth.access_token,
    );
    if (this.config.clientId && appInfo.result?.CODE !== this.config.clientId) {
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.APP_INVALID);
    }
    // Moving to another portal is the admin's call: only the portal that BITRIX24_DOMAIN names
    // may replace the stored installation of a different one.
    const allowPortalChange = event.auth.domain === this.config.portalDomain;
    const tokens = {
      memberId: event.auth.member_id,
      domain: event.auth.domain,
      scope: event.auth.scope,
      status: event.auth.status,
      clientEndpoint: event.auth.client_endpoint,
      serverEndpoint: event.auth.server_endpoint,
      accessToken: event.auth.access_token,
      refreshToken: event.auth.refresh_token,
      applicationToken: event.auth.application_token,
      expiresIn: event.auth.expires_in,
    };
    await this.repository.saveTokens(tokens, { allowPortalChange });
  }

  async install(payload: unknown): Promise<void> {
    if (!this.config.portalDomain) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.CONFIG);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new BadRequestException('Bitrix install payload is invalid');
    }
    const event = normalizeInstallPayload(payload as Record<string, unknown>);
    if (!validateBitrixInstallEvent(event, this.config.portalDomain)) {
      throw new BadRequestException('Bitrix install endpoint is not allowed');
    }
    await this.handleInstallEvent(event);
  }

  /** Builds the consent URL and remembers a one-time `state` to protect the callback (CSRF). */
  async createAuthorizationUrl(): Promise<string> {
    if (!this.config.clientId || !this.config.portalDomain) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.CONFIG);
    }
    const state = await this.stateStore.issue(this.config.stateTtlSeconds * 1000);
    const url = new URL(`https://${this.config.portalDomain}/oauth/authorize/`);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Second half of the full OAuth flow: checks `state`, exchanges `code`, stores the tokens. */
  async completeAuthorization(code: string | undefined, state: string | undefined): Promise<void> {
    if (!code) throw new BadRequestException(BITRIX_MESSAGES.ERROR.CODE_REQUIRED);
    if (!state) throw new BadRequestException(BITRIX_MESSAGES.ERROR.STATE_INVALID);
    if (!(await this.stateStore.consume(state)))
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.STATE_INVALID);
    const token = await this.exchange({ grant_type: 'authorization_code', code });
    await this.repository.saveTokens(this.toTokenSet(token, null));
  }

  /** Access token for the next call; refreshed first when it expires within the skew window. */
  async getAccessToken(): Promise<string> {
    const current = await this.repository.findCurrent();
    if (!current)
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.INSTALLATION_REQUIRED);
    if (!this.isNearExpiry(current)) return current.accessToken;
    return this.refreshAccessToken();
  }

  /**
   * Returns a usable access token, refreshing at most once however many callers ask.
   * Pass `rejectedToken` when Bitrix24 refused a token: if the stored token is already a
   * different one, somebody refreshed in the meantime and that token is returned as is.
   * Callers inside this process share one promise; other processes are held off by a
   * database lock (see BitrixInstallationRepository.acquireRefreshLock).
   */
  refreshAccessToken(rejectedToken?: string): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh(rejectedToken).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(rejectedToken?: string): Promise<string> {
    const deadline = nowMs() + BITRIX_REFRESH_LOCK.LEASE_MS;
    for (;;) {
      const current = await this.repository.findCurrent();
      if (!current)
        throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.INSTALLATION_REQUIRED);
      if (this.isAlreadyRefreshed(current, rejectedToken)) return current.accessToken;

      const lease = await this.repository.acquireRefreshLock(
        current.id,
        current.refreshToken,
        BITRIX_REFRESH_LOCK.LEASE_MS,
      );
      if (lease) return this.refreshWithLock(current, lease);

      // Another process is refreshing: wait for its result instead of spending the same
      // refresh token twice. If it gives up, the next round takes the lock over.
      if (nowMs() >= deadline) {
        throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.REFRESH_FAILED);
      }
      await new Promise((resolve) => setTimeout(resolve, BITRIX_REFRESH_LOCK.POLL_MS));
    }
  }

  private async refreshWithLock(
    current: BitrixInstallationSnapshot,
    lease: RefreshLease,
  ): Promise<string> {
    let token: OAuthTokenResponse;
    try {
      token = await this.exchange({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      });
    } catch (error) {
      await this.repository.releaseRefreshLock(lease);
      if (error instanceof BitrixHttpError) {
        throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.REFRESH_FAILED);
      }
      throw error;
    }

    // A refresh answers with scope "app", so the scope granted at install time is kept.
    const stored = await this.repository.replaceTokens(lease, current.refreshToken, {
      ...this.toTokenSet(token, current.applicationToken),
      scope: current.scope,
    });
    if (stored) return token.access_token;

    // A reinstall replaced the tokens while the request was in flight; its tokens win.
    const latest = await this.repository.findCurrent();
    if (!latest) throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.INSTALLATION_REQUIRED);
    return latest.accessToken;
  }

  private isAlreadyRefreshed(current: BitrixInstallationSnapshot, rejectedToken?: string): boolean {
    if (rejectedToken !== undefined) return current.accessToken !== rejectedToken;
    return !this.isNearExpiry(current);
  }

  private isNearExpiry(current: BitrixInstallationSnapshot): boolean {
    const expiresAt = Temporal.Instant.from(current.accessTokenExpiresAt.toISOString());
    const threshold = Temporal.Instant.from(nowIso()).add({
      seconds: this.config.refreshSkewSeconds,
    });
    return Temporal.Instant.compare(expiresAt, threshold) <= 0;
  }

  /** Calls the token endpoint of oauth.bitrix.info with the client id and secret. */
  private async exchange(params: Record<string, string>): Promise<OAuthTokenResponse> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.CONFIG);
    }
    const url = new URL(BITRIX_REST.OAUTH_TOKEN_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('client_secret', this.config.clientSecret);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.transport.getJson<
      OAuthTokenResponse | BitrixRestEnvelope<OAuthTokenResponse>
    >(url.toString());
    if ('error' in response && response.error)
      throw new ServiceUnavailableException(response.error_description);
    if (!('access_token' in response) || !response.access_token || !response.refresh_token) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.REFRESH_FAILED);
    }
    return response;
  }

  private toTokenSet(token: OAuthTokenResponse, applicationToken: string | null): BitrixTokenSet {
    return {
      memberId: token.member_id,
      // `domain` in a token-server response is oauth.bitrix.info; the portal is in client_endpoint.
      domain: new URL(token.client_endpoint).hostname,
      scope: token.scope,
      status: token.status,
      clientEndpoint: token.client_endpoint,
      serverEndpoint: token.server_endpoint,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      applicationToken,
      expiresIn: token.expires_in,
    };
  }

  private validateAuth(auth: BitrixInstallEvent['auth']): void {
    if (!this.config.portalDomain) {
      throw new ServiceUnavailableException(BITRIX_MESSAGES.ERROR.CONFIG);
    }
    const required = [
      auth.domain,
      auth.scope,
      auth.access_token,
      auth.refresh_token,
      auth.server_endpoint,
      auth.client_endpoint,
      auth.member_id,
      auth.application_token,
    ];
    if (
      required.some((value) => typeof value !== 'string' || value.length === 0) ||
      !auth.expires_in
    ) {
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.EVENT_INVALID);
    }
    if (
      !validateBitrixInstallEvent({ event: '', data: {}, ts: '', auth }, this.config.portalDomain)
    ) {
      throw new BadRequestException(BITRIX_MESSAGES.ERROR.EVENT_INVALID);
    }
  }
}
