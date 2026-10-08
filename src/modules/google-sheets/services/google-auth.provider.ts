import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { googleConfig } from '@config/index.js';
import type { GoogleConfig } from '@config/index.js';

import { auth, sheets } from '@googleapis/sheets';
import type { sheets_v4 } from '@googleapis/sheets';
import { Inject, Injectable } from '@nestjs/common';

import { GOOGLE_SHEETS_SCOPE } from '../constants/index.js';
import { SheetsError } from '../errors/sheets.error.js';
import { GOOGLE_SHEETS_MESSAGES } from '../messages/index.js';

type ServiceAccountKey = { client_email: string; private_key: string };

const { ERROR } = GOOGLE_SHEETS_MESSAGES;

/**
 * Builds the authenticated Sheets API client. With a service account the client signs a JWT;
 * with OAuth it uses the refresh token stored after the user's consent. Either way it fetches
 * and refreshes the access token by itself. Nothing is read or built until the first call, so
 * the app starts fine without any Google configuration.
 */
@Injectable()
export class GoogleAuthProvider {
  private api: sheets_v4.Sheets | undefined;

  constructor(@Inject(googleConfig.KEY) private readonly config: GoogleConfig) {}

  /** Why the Google side cannot be used, or null when it is configured. */
  missingConfig(): string | null {
    if (!this.config.sheetId) return ERROR.SHEET_ID_MISSING;
    if (this.config.authMode === 'oauth') {
      const { oauthClientId, oauthClientSecret, oauthRedirectUri } = this.config;
      if (!oauthClientId || !oauthClientSecret || !oauthRedirectUri) {
        return ERROR.OAUTH_CONFIG_MISSING;
      }
      return existsSync(resolve(this.config.oauthTokenFile)) ? null : ERROR.OAUTH_NOT_AUTHORIZED;
    }
    if (!this.config.serviceAccountKeyBase64 && !this.config.serviceAccountKeyFile) {
      return ERROR.KEY_MISSING;
    }
    return null;
  }

  getApi(): sheets_v4.Sheets {
    if (this.api) return this.api;

    const missing = this.missingConfig();
    if (missing) throw new SheetsError(missing, 'config');

    this.api = sheets({
      version: 'v4',
      auth: this.config.authMode === 'oauth' ? this.oauthClient() : this.serviceAccountClient(),
    });
    return this.api;
  }

  /** Drops the cached client: the next call reads the credentials again. */
  reset(): void {
    this.api = undefined;
  }

  private serviceAccountClient(): InstanceType<typeof auth.JWT> {
    const key = this.readKey();
    return new auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [GOOGLE_SHEETS_SCOPE],
    });
  }

  private oauthClient(): InstanceType<typeof auth.OAuth2> {
    let refreshToken: unknown;
    try {
      const text = readFileSync(resolve(this.config.oauthTokenFile), 'utf8');
      refreshToken = (JSON.parse(text) as { refresh_token?: unknown }).refresh_token;
    } catch {
      refreshToken = undefined;
    }
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new SheetsError(ERROR.OAUTH_TOKEN_INVALID, 'config');
    }

    const client = new auth.OAuth2(
      this.config.oauthClientId,
      this.config.oauthClientSecret,
      this.config.oauthRedirectUri,
    );
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  /** The base64 variable wins over the file, so a container needs no mounted secret. */
  private readKey(): ServiceAccountKey {
    const { serviceAccountKeyBase64, serviceAccountKeyFile } = this.config;
    let text: string;
    if (serviceAccountKeyBase64) {
      text = Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8');
    } else {
      const path = serviceAccountKeyFile ?? '';
      try {
        text = readFileSync(resolve(path), 'utf8');
      } catch {
        throw new SheetsError(ERROR.KEY_UNREADABLE(path), 'config');
      }
    }

    let key: Partial<ServiceAccountKey>;
    try {
      key = JSON.parse(text) as Partial<ServiceAccountKey>;
    } catch {
      throw new SheetsError(ERROR.KEY_INVALID, 'config');
    }
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
      throw new SheetsError(ERROR.KEY_INVALID, 'config');
    }
    return { client_email: key.client_email, private_key: key.private_key };
  }
}
