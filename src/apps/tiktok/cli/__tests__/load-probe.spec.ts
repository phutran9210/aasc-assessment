import { runLoadProbe } from '../load-probe.js';

describe('runLoadProbe', () => {
  const keys = [
    'TIKTOK_DEMO_BASE_URL',
    'TIKTOK_BITRIX24_WEBHOOK_URL',
    'TIKTOK_ADVERTISER_ID',
    'TIKTOK_WEBHOOK_SECRET',
    'BITRIX_MOCK_EVENT_SECRET',
    'TIKTOK_PROBE_COUNT',
    'TIKTOK_PROBE_CONCURRENCY',
    'TIKTOK_PROBE_RATE',
    'TIKTOK_PROBE_SECONDS',
  ] as const;
  const prior = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const key of keys) prior.set(key, process.env[key]);
    process.env.TIKTOK_DEMO_BASE_URL = 'http://mock.test';
    process.env.TIKTOK_BITRIX24_WEBHOOK_URL = 'http://bitrix.test/rest/';
    process.env.TIKTOK_ADVERTISER_ID = 'adv';
    process.env.TIKTOK_WEBHOOK_SECRET = 'secret';
    process.env.BITRIX_MOCK_EVENT_SECRET = 'event-secret';
    process.env.TIKTOK_PROBE_COUNT = '3';
    process.env.TIKTOK_PROBE_CONCURRENCY = '2';
    delete process.env.TIKTOK_PROBE_RATE;
    delete process.env.TIKTOK_PROBE_SECONDS;
  });
  afterEach(() => {
    for (const key of keys) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('aggregates response statuses and transport failures', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockRejectedValueOnce(new Error('offline'));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await runLoadProbe();
    const report = JSON.parse(log.mock.calls[0][0] as string) as Record<string, any>;
    expect(report).toMatchObject({
      requests: 3,
      transportFailures: 1,
      statuses: { 200: 1, 429: 1 },
      latencyMs: { p50: expect.any(Number), p95: expect.any(Number) },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('supports open-loop rate mode and rejects unsafe request limits', async () => {
    process.env.TIKTOK_PROBE_RATE = '2';
    process.env.TIKTOK_PROBE_SECONDS = '1';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await runLoadProbe();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      requests: 2,
      mode: '2 requests/second for 1s',
    });

    delete process.env.TIKTOK_PROBE_RATE;
    process.env.TIKTOK_PROBE_COUNT = '0';
    await expect(runLoadProbe()).rejects.toThrow('TIKTOK_PROBE_COUNT must be an integer');
  });
});
