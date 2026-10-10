import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertMockMode, demoOptionsFromEnvironment, readSample } from '../demo-environment.js';

describe('TikTok demo environment', () => {
  const keys = [
    'TIKTOK_MODE',
    'BITRIX_INTEGRATION_MODE',
    'TIKTOK_DEMO_BASE_URL',
    'TIKTOK_BITRIX24_WEBHOOK_URL',
    'TIKTOK_ADVERTISER_ID',
    'BITRIX_PORTAL_KEY',
    'TIKTOK_WEBHOOK_SECRET',
    'BITRIX_MOCK_EVENT_SECRET',
    'TIKTOK_DEMO_USERNAME',
    'TIKTOK_DEMO_PASSWORD',
    'REPORT_TIMEZONE',
    'TIKTOK_DEMO_TIMEOUT_MS',
  ];
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('defaults to mock mode and fills optional demo settings from defaults', () => {
    assertMockMode();
    Object.assign(process.env, {
      TIKTOK_BITRIX24_WEBHOOK_URL: 'https://bitrix.test/rest/',
      TIKTOK_ADVERTISER_ID: 'adv',
      TIKTOK_WEBHOOK_SECRET: 'webhook-secret',
      BITRIX_MOCK_EVENT_SECRET: 'event-secret',
    });

    expect(demoOptionsFromEnvironment()).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:3001',
      portalKey: 'mock-portal',
      username: 'demo-admin',
      timeoutMs: 120_000,
    });
  });

  it('rejects live provider modes and reports missing required settings', () => {
    process.env.TIKTOK_MODE = 'business-api';
    expect(() => assertMockMode()).toThrow('Demo tools only run in mock mode');
    delete process.env.TIKTOK_MODE;
    process.env.BITRIX_INTEGRATION_MODE = 'oauth';
    expect(() => assertMockMode()).toThrow('BITRIX_INTEGRATION_MODE=oauth');
    expect(() => demoOptionsFromEnvironment()).toThrow('TIKTOK_BITRIX24_WEBHOOK_URL is required');
  });

  it('reads one JSON object and rejects arrays and primitive samples', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aasc-demo-sample-'));
    try {
      const objectPath = join(directory, 'object.json');
      await writeFile(objectPath, '{"lead":true}');
      await expect(readSample(objectPath)).resolves.toEqual({ lead: true });
      const arrayPath = join(directory, 'array.json');
      await writeFile(arrayPath, '[]');
      await expect(readSample(arrayPath)).rejects.toThrow('one JSON object');
      const primitivePath = join(directory, 'primitive.json');
      await writeFile(primitivePath, 'null');
      await expect(readSample(primitivePath)).rejects.toThrow('one JSON object');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
