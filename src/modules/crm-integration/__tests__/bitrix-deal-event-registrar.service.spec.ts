import { BitrixHttpError } from '@modules/bitrix/services/bitrix-http-transport.service.js';
import {
  BITRIX_DEAL_EVENTS,
  BitrixDealEventRegistrar,
} from '../services/bitrix-deal-event-registrar.service.js';

const BASE_ENV = {
  TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
  TIKTOK_REDIS_URL: 'redis://localhost:6379',
  TIKTOK_JWT_SECRET: 'a'.repeat(32),
  TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
  TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
  TIKTOK_ADVERTISER_ID: 'advertiser-test',
  TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
  BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
};

function setup(mode: 'webhook' | 'oauth' = 'oauth') {
  const api = { mode, callRaw: jest.fn().mockResolvedValue({ result: true }) };
  return { registrar: new BitrixDealEventRegistrar(api as never), api };
}

describe('BitrixDealEventRegistrar', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...BASE_ENV, TIKTOK_PUBLIC_URL: 'https://app.example.test' };
  });

  afterAll(() => {
    process.env = original;
  });

  it('should bind the three deal events to the public callback URL when the app uses OAuth', async () => {
    const { registrar, api } = setup();

    await expect(registrar.register()).resolves.toEqual({
      status: 'registered',
      handler: 'https://app.example.test/webhooks/bitrix24/deals',
    });
    expect(api.callRaw.mock.calls).toEqual(
      BITRIX_DEAL_EVENTS.map((event) => [
        'event.bind',
        { event, handler: 'https://app.example.test/webhooks/bitrix24/deals' },
      ]),
    );
  });

  it('should treat an event that is already bound as registered', async () => {
    const { registrar, api } = setup();
    api.callRaw.mockRejectedValueOnce(
      new BitrixHttpError('Handler already binded', 'ERROR_CORE', 400),
    );

    await expect(registrar.register()).resolves.toMatchObject({ status: 'registered' });
    expect(api.callRaw).toHaveBeenCalledTimes(3);
  });

  it('should skip registration when the portal is reached through an incoming webhook', async () => {
    const { registrar, api } = setup('webhook');

    await expect(registrar.register()).resolves.toEqual({
      status: 'skipped',
      reason: 'webhook_mode',
    });
    expect(api.callRaw).not.toHaveBeenCalled();
  });

  it('should skip registration when no public URL is configured', async () => {
    delete process.env.TIKTOK_PUBLIC_URL;
    const { registrar, api } = setup();

    await expect(registrar.register()).resolves.toEqual({
      status: 'skipped',
      reason: 'public_url_missing',
    });
    expect(api.callRaw).not.toHaveBeenCalled();
  });

  it('should report a failure without throwing when Bitrix24 refuses the binding', async () => {
    const { registrar, api } = setup();
    api.callRaw.mockRejectedValue(
      new BitrixHttpError('insufficient_scope', 'insufficient_scope', 401),
    );

    await expect(registrar.register()).resolves.toEqual({ status: 'failed' });
  });
});
