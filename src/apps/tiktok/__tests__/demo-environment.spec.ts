import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertMockMode, demoOptionsFromEnvironment, readSample } from '../cli/demo-environment.js';

describe('TikTok demo environment', () => {
  const prior = {
    tiktok: process.env.TIKTOK_MODE,
    bitrix: process.env.BITRIX_INTEGRATION_MODE,
    endpoint: process.env.TIKTOK_BITRIX24_WEBHOOK_URL,
    advertiser: process.env.TIKTOK_ADVERTISER_ID,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries({
      TIKTOK_MODE: prior.tiktok,
      BITRIX_INTEGRATION_MODE: prior.bitrix,
      TIKTOK_BITRIX24_WEBHOOK_URL: prior.endpoint,
      TIKTOK_ADVERTISER_ID: prior.advertiser,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('accepts the local mock providers and rejects a real provider mode', () => {
    process.env.TIKTOK_MODE = 'mock';
    process.env.BITRIX_INTEGRATION_MODE = 'mock';
    expect(() => assertMockMode()).not.toThrow();
    process.env.BITRIX_INTEGRATION_MODE = 'real';
    expect(() => assertMockMode()).toThrow('Demo tools only run in mock mode');
  });

  it('requires the mock Bitrix endpoint before starting a demo', () => {
    delete process.env.TIKTOK_BITRIX24_WEBHOOK_URL;
    expect(() => demoOptionsFromEnvironment()).toThrow('TIKTOK_BITRIX24_WEBHOOK_URL is required');
  });

  it('reads demo options from the environment and trims the API base URL slash', () => {
    const originalBaseUrl = process.env.TIKTOK_DEMO_BASE_URL;
    process.env.TIKTOK_DEMO_BASE_URL = 'http://127.0.0.1:3001/';
    process.env.TIKTOK_BITRIX24_WEBHOOK_URL = 'http://127.0.0.1:3002/rest/';
    try {
      expect(demoOptionsFromEnvironment()).toMatchObject({
        apiBaseUrl: 'http://127.0.0.1:3001',
        bitrixRestUrl: 'http://127.0.0.1:3002/rest/',
      });
    } finally {
      if (originalBaseUrl === undefined) delete process.env.TIKTOK_DEMO_BASE_URL;
      else process.env.TIKTOK_DEMO_BASE_URL = originalBaseUrl;
    }
  });

  it('reads a JSON object sample and rejects arrays', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aasc-demo-sample-'));
    const path = join(root, 'sample.json');
    try {
      await writeFile(path, '{"event":"lead.generate"}');
      await expect(readSample(path)).resolves.toEqual({ event: 'lead.generate' });
      await writeFile(path, '["lead.generate"]');
      await expect(readSample(path)).rejects.toThrow(
        'The sample file must contain one JSON object',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
