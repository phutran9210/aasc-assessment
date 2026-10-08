import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { nowMs } from '@common/utils/index.js';
import { googleConfig } from '@config/index.js';
import type { GoogleConfig } from '@config/index.js';

import { auth } from '@googleapis/sheets';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { GOOGLE_OAUTH_STATE_TTL_MS, GOOGLE_SHEETS_SCOPE } from '../constants/index.js';
import { GOOGLE_SHEETS_MESSAGES } from '../messages/index.js';
import { GoogleAuthProvider } from './google-auth.provider.js';

const { ERROR } = GOOGLE_SHEETS_MESSAGES;

/**
 * OAuth 2.0 user consent for Google Sheets (`GOOGLE_AUTH_MODE=oauth`). The user opens the consent
 * URL once; the refresh token Google returns is kept in a file next to the other secrets and
 * GoogleAuthProvider uses it from then on.
 */
@Injectable()
export class GoogleOAuthService {
  /** One-time `state` values with their expiry, to tie a callback to a URL issued here (CSRF). */
  private readonly states = new Map<string, number>();

  constructor(
    @Inject(googleConfig.KEY) private readonly config: GoogleConfig,
    private readonly provider: GoogleAuthProvider,
  ) {}

  authorizationUrl(): string {
    const client = this.createClient();
    const state = randomUUID();
    this.states.set(state, nowMs() + GOOGLE_OAUTH_STATE_TTL_MS);
    // `offline` + `consent` make Google return a refresh token every time, not only the first.
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [GOOGLE_SHEETS_SCOPE],
      state,
    });
  }

  /** Exchanges `code` for tokens and stores the refresh token. */
  async complete(code: string, state: string): Promise<void> {
    if (!this.consumeState(state)) throw new BadRequestException(ERROR.OAUTH_STATE_INVALID);
    if (!code) throw new BadRequestException(ERROR.OAUTH_CODE_REQUIRED);

    let refreshToken: string | null | undefined;
    try {
      const { tokens } = await this.createClient().getToken(code);
      refreshToken = tokens.refresh_token;
    } catch {
      // Google's reason can echo the code or the client id: keep it out of the response.
      throw new BadGatewayException(ERROR.OAUTH_CODE_REJECTED);
    }
    if (!refreshToken) throw new BadRequestException(ERROR.OAUTH_NO_REFRESH_TOKEN);

    await this.store(refreshToken);
    this.provider.reset();
  }

  private createClient(): InstanceType<typeof auth.OAuth2> {
    const { authMode, oauthClientId, oauthClientSecret, oauthRedirectUri } = this.config;
    if (authMode !== 'oauth') throw new ServiceUnavailableException(ERROR.OAUTH_MODE_OFF);
    if (!oauthClientId || !oauthClientSecret || !oauthRedirectUri) {
      throw new ServiceUnavailableException(ERROR.OAUTH_CONFIG_MISSING);
    }
    return new auth.OAuth2(oauthClientId, oauthClientSecret, oauthRedirectUri);
  }

  /** Written through a temporary file, readable by the owner only. */
  private async store(refreshToken: string): Promise<void> {
    const path = resolve(this.config.oauthTokenFile);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, JSON.stringify({ refresh_token: refreshToken }), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true });
      throw new ServiceUnavailableException(
        ERROR.OAUTH_TOKEN_UNWRITABLE(this.config.oauthTokenFile),
      );
    }
  }

  private consumeState(state: string): boolean {
    const expiresAt = this.states.get(state);
    this.states.delete(state);
    return expiresAt !== undefined && expiresAt > nowMs();
  }
}
