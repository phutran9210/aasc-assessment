import { verifyMockSignature } from '@modules/tiktok/domain/mock-signature.js';
import { assertMockMode, demoOptionsFromEnvironment } from '../cli/demo-environment.js';
import { demoLeadPayload, signWebhook } from '../cli/demo-flow.js';
import { percentile } from '../cli/statistics.js';

describe('demo tools', () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('computes nearest-rank percentiles', () => {
    const sample = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    expect(percentile(sample, 0.5)).toBe(50);
    expect(percentile(sample, 0.95)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('signs a webhook body the way the mock verifier expects', () => {
    const secret = 'demo-tools-webhook-secret';
    const body = Buffer.from(JSON.stringify(demoLeadPayload('adv-1', 'evt-1')), 'utf8');
    const timestamp = 1_800_000_000;

    const header = signWebhook(secret, body, timestamp);

    expect(header).toMatch(/^t=1800000000,s=[0-9a-f]{64}$/);
    expect(() => verifyMockSignature(body, header, secret, timestamp)).not.toThrow();
    expect(() =>
      verifyMockSignature(Buffer.concat([body, Buffer.from(' ')]), header, secret, timestamp),
    ).toThrow();
  });

  it('refuses to run against a real provider', () => {
    process.env.TIKTOK_MODE = 'mock';
    process.env.BITRIX_INTEGRATION_MODE = 'mock';
    expect(() => assertMockMode()).not.toThrow();

    process.env.BITRIX_INTEGRATION_MODE = 'real';
    expect(() => assertMockMode()).toThrow(/mock mode/);
    process.env.BITRIX_INTEGRATION_MODE = 'mock';
    process.env.TIKTOK_MODE = 'business-api';
    expect(() => assertMockMode()).toThrow(/mock mode/);
  });

  it('reads every demo setting from the environment and names the missing one', () => {
    Object.assign(process.env, {
      TIKTOK_BITRIX24_WEBHOOK_URL: 'http://127.0.0.1:3002/rest/1/mock/',
      TIKTOK_ADVERTISER_ID: 'adv-1',
      TIKTOK_WEBHOOK_SECRET: 'demo-tools-webhook-secret',
      BITRIX_MOCK_EVENT_SECRET: 'demo-tools-bitrix-secret',
      TIKTOK_DEMO_BASE_URL: 'http://127.0.0.1:3001/',
    });

    expect(demoOptionsFromEnvironment()).toMatchObject({
      apiBaseUrl: 'http://127.0.0.1:3001',
      advertiserId: 'adv-1',
      username: 'demo-admin',
    });
    delete process.env.TIKTOK_WEBHOOK_SECRET;
    expect(() => demoOptionsFromEnvironment()).toThrow('TIKTOK_WEBHOOK_SECRET is required');
  });
});
