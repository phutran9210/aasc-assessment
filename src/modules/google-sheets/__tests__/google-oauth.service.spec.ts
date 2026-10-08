import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GoogleConfig } from '@config/index.js';

import { auth } from '@googleapis/sheets';

import { GoogleAuthProvider } from '../services/google-auth.provider.js';
import { GoogleOAuthService } from '../services/google-oauth.service.js';

describe('GoogleOAuthService', () => {
  let directory: string;
  let config: GoogleConfig;
  let provider: GoogleAuthProvider;
  let service: GoogleOAuthService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'google-oauth-'));
    config = {
      authMode: 'oauth',
      serviceAccountKeyFile: undefined,
      serviceAccountKeyBase64: undefined,
      oauthClientId: 'client-id.apps.googleusercontent.com',
      oauthClientSecret: 'client-secret',
      oauthRedirectUri: 'http://localhost:3000/google/oauth/callback',
      oauthTokenFile: join(directory, 'nested', 'token.json'),
      sheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      sheetName: 'Leads',
      timeoutMs: 30_000,
      maxRetries: 2,
      retryBaseDelayMs: 0,
    };
    provider = new GoogleAuthProvider(config);
    service = new GoogleOAuthService(config, provider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  const stateOf = (url: string): string => new URL(url).searchParams.get('state') ?? '';

  it('should build a consent URL that asks for offline access to Sheets', () => {
    const url = new URL(service.authorizationUrl());

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/google/oauth/callback',
    );
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should say what to configure when the OAuth client settings are missing', () => {
    const incomplete = new GoogleOAuthService({ ...config, oauthClientId: undefined }, provider);

    expect(() => incomplete.authorizationUrl()).toThrow(/^Chưa cấu hình Google OAuth/);
  });

  it('should store the refresh token, readable by the owner only, and reset the API client', async () => {
    jest
      .spyOn(auth.OAuth2.prototype, 'getToken')
      .mockResolvedValue({ tokens: { refresh_token: 'r-1', access_token: 'a-1' } } as never);
    const reset = jest.spyOn(provider, 'reset');
    const state = stateOf(service.authorizationUrl());

    await service.complete('code-1', state);

    expect(JSON.parse(readFileSync(config.oauthTokenFile, 'utf8'))).toEqual({
      refresh_token: 'r-1',
    });
    expect(statSync(config.oauthTokenFile).mode & 0o777).toBe(0o600);
    expect(reset).toHaveBeenCalled();
    expect(provider.missingConfig()).toBeNull();
  });

  it('should refuse a callback whose state it did not issue, or that is used twice', async () => {
    const getToken = jest
      .spyOn(auth.OAuth2.prototype, 'getToken')
      .mockResolvedValue({ tokens: { refresh_token: 'r-1' } } as never);
    const state = stateOf(service.authorizationUrl());

    await expect(service.complete('code-1', 'forged')).rejects.toThrow(
      'Yêu cầu cấp quyền Google không hợp lệ hoặc đã hết hạn; mở lại GET /google/oauth/authorize',
    );
    expect(getToken).not.toHaveBeenCalled();
    await service.complete('code-1', state);
    await expect(service.complete('code-1', state)).rejects.toThrow(/không hợp lệ hoặc đã hết hạn/);
  });

  it('should explain how to get a refresh token when Google returns none', async () => {
    jest
      .spyOn(auth.OAuth2.prototype, 'getToken')
      .mockResolvedValue({ tokens: { access_token: 'a-1' } } as never);

    await expect(service.complete('code-1', stateOf(service.authorizationUrl()))).rejects.toThrow(
      /Google không trả refresh token/,
    );
  });

  it('should report a rejected code without leaking the reason Google gave', async () => {
    jest
      .spyOn(auth.OAuth2.prototype, 'getToken')
      .mockRejectedValue(new Error('invalid_grant') as never);

    await expect(service.complete('code-1', stateOf(service.authorizationUrl()))).rejects.toThrow(
      'Google từ chối mã cấp quyền; mở lại GET /google/oauth/authorize',
    );
  });
});
