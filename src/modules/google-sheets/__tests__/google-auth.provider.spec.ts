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
    expect(new GoogleAuthProvider(config({ authMode: 'oauth' })).missingConfig()).toMatch(
      /oauth chưa được hỗ trợ/,
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
});
