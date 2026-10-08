import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GoogleConfig } from '@config/index.js';

import { GoogleAuthProvider } from '../services/google-auth.provider.js';

const KEY = { client_email: 'sa@project.iam.gserviceaccount.com', private_key: 'PRIVATE' };

const config = (overrides: Partial<GoogleConfig> = {}): GoogleConfig => ({
  authMode: 'service_account',
  serviceAccountKeyFile: undefined,
  serviceAccountKeyBase64: Buffer.from(JSON.stringify(KEY)).toString('base64'),
  oauthClientId: undefined,
  oauthClientSecret: undefined,
  oauthRedirectUri: undefined,
  oauthTokenFile: 'secrets/google-oauth-token.json',
  sheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  sheetName: 'Leads',
  timeoutMs: 30_000,
  maxRetries: 2,
  retryBaseDelayMs: 0,
  ...overrides,
});

describe('GoogleAuthProvider', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'google-key-'));
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('should report what is missing, in the order a user would fix it', () => {
    expect(new GoogleAuthProvider(config({ sheetId: undefined })).missingConfig()).toBe(
      'Chưa cấu hình GOOGLE_SHEET_ID',
    );
    expect(
      new GoogleAuthProvider(config({ serviceAccountKeyBase64: undefined })).missingConfig(),
    ).toMatch(/Chưa cấu hình khóa service account/);
    expect(new GoogleAuthProvider(config()).missingConfig()).toBeNull();
  });

  it('should build one API client from the base64 key and reuse it', () => {
    const provider = new GoogleAuthProvider(config());
    const api = provider.getApi();

    expect(typeof api.spreadsheets.values.batchGet).toBe('function');
    expect(provider.getApi()).toBe(api);
  });

  it('should build the API client from a key file', () => {
    const path = join(directory, 'sa.json');
    writeFileSync(path, JSON.stringify(KEY));
    const provider = new GoogleAuthProvider(
      config({ serviceAccountKeyBase64: undefined, serviceAccountKeyFile: path }),
    );

    expect(typeof provider.getApi().spreadsheets.get).toBe('function');
  });

  it('should fail with kind "config" when the key cannot be used', () => {
    const missingFile = new GoogleAuthProvider(
      config({ serviceAccountKeyBase64: undefined, serviceAccountKeyFile: join(directory, 'x') }),
    );
    expect(() => missingFile.getApi()).toThrow(
      expect.objectContaining({
        kind: 'config',
        message: expect.stringContaining('Không đọc được'),
      }),
    );

    const path = join(directory, 'bad.json');
    writeFileSync(path, JSON.stringify({ client_email: 'only@email' }));
    const badFile = new GoogleAuthProvider(
      config({ serviceAccountKeyBase64: undefined, serviceAccountKeyFile: path }),
    );
    expect(() => badFile.getApi()).toThrow(expect.objectContaining({ kind: 'config' }));

    expect(() => new GoogleAuthProvider(config({ sheetId: undefined })).getApi()).toThrow(
      expect.objectContaining({ kind: 'config', message: 'Chưa cấu hình GOOGLE_SHEET_ID' }),
    );
  });

  it('should never put the private key in an error message', () => {
    const path = join(directory, 'bad.json');
    writeFileSync(path, '{"private_key":"TOP-SECRET"');
    const provider = new GoogleAuthProvider(
      config({ serviceAccountKeyBase64: undefined, serviceAccountKeyFile: path }),
    );

    expect(() => provider.getApi()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('TOP-SECRET') }),
    );
  });

  describe('OAuth mode', () => {
    const oauth = (overrides: Partial<GoogleConfig> = {}): GoogleConfig =>
      config({
        authMode: 'oauth',
        oauthClientId: 'client-id.apps.googleusercontent.com',
        oauthClientSecret: 'client-secret',
        oauthRedirectUri: 'http://localhost:3000/google/oauth/callback',
        oauthTokenFile: join(directory, 'token.json'),
        ...overrides,
      });

    it('should ask for the OAuth client settings first, then for the consent', () => {
      expect(new GoogleAuthProvider(oauth({ oauthClientSecret: undefined })).missingConfig()).toBe(
        'Chưa cấu hình Google OAuth: đặt GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET và GOOGLE_OAUTH_REDIRECT_URI',
      );
      expect(new GoogleAuthProvider(oauth()).missingConfig()).toBe(
        'Chưa cấp quyền Google: đăng nhập rồi mở GET /google/oauth/authorize và làm theo đường dẫn trả về',
      );
    });

    it('should build the API client from the stored refresh token', () => {
      writeFileSync(join(directory, 'token.json'), JSON.stringify({ refresh_token: 'r-1' }));
      const provider = new GoogleAuthProvider(oauth());

      expect(provider.missingConfig()).toBeNull();
      expect(provider.getApi()).toBe(provider.getApi());
    });

    it('should reject a token file without a refresh token', () => {
      writeFileSync(join(directory, 'token.json'), '{"access_token":"a"}');

      expect(() => new GoogleAuthProvider(oauth()).getApi()).toThrow(
        'File token Google OAuth không hợp lệ: cấp quyền lại qua GET /google/oauth/authorize',
      );
    });

    it('should build a new client after reset, so a fresh consent takes effect', () => {
      writeFileSync(join(directory, 'token.json'), JSON.stringify({ refresh_token: 'r-1' }));
      const provider = new GoogleAuthProvider(oauth());
      const first = provider.getApi();

      provider.reset();

      expect(provider.getApi()).not.toBe(first);
    });
  });
});
