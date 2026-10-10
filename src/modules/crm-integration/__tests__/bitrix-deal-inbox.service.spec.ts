import { BitrixDealInbox } from '../services/bitrix-deal-inbox.service.js';

describe('BitrixDealInbox', () => {
  const accepted = { eventId: 'event-1', duplicate: false };
  const events = {
    accept: jest.fn().mockResolvedValue(accepted),
    findById: jest.fn(),
    findByIdForUpdate: jest.fn(),
    save: jest.fn(),
    updateStatus: jest.fn(),
  };
  const operations = {
    findById: jest.fn(),
    findByKey: jest.fn(),
    findByKeyForUpdate: jest.fn(),
    findByIdForUpdate: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    hasActiveAggregateOperation: jest.fn(),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-1', status: 'pending' }),
  };
  const outbox = {
    append: jest.fn().mockResolvedValue(undefined),
    hasUnpublished: jest.fn().mockResolvedValue(false),
  };
  const api = { mode: 'oauth', verifyApplicationToken: jest.fn().mockResolvedValue(false) };
  const installations = { findCurrent: jest.fn().mockResolvedValue(null) };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: object) => Promise<unknown>) => callback({})),
  };
  const inbox = new BitrixDealInbox(
    dataSource as never,
    events,
    operations,
    outbox,
    api as never,
    installations as never,
  );

  beforeEach(() => {
    Object.assign(process.env, {
      TIKTOK_DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/tiktok',
      TIKTOK_REDIS_URL: 'redis://127.0.0.1:6379',
      TIKTOK_JWT_SECRET: 'a'.repeat(32),
      TIKTOK_JWT_ISSUER: 'tiktok-test',
      TIKTOK_JWT_AUDIENCE: 'tiktok-test',
      TIKTOK_ADVERTISER_ID: 'advertiser-test',
      TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
    });
    process.env.BITRIX_INTEGRATION_MODE = 'mock';
    process.env.BITRIX_PORTAL_KEY = 'mock-portal';
    process.env.BITRIX_MOCK_EVENT_SECRET = 'mock-bitrix-event-secret-for-tests';
    delete process.env.TIKTOK_BITRIX24_WEBHOOK_URL;
    delete process.env.TIKTOK_BITRIX24_OUTGOING_TOKEN;
    api.mode = 'oauth';
    installations.findCurrent.mockResolvedValue(null);
    api.verifyApplicationToken.mockResolvedValue(false);
    jest.clearAllMocks();
    events.accept.mockResolvedValue(accepted);
    operations.ensure.mockResolvedValue({ id: 'operation-1', status: 'pending' });
  });

  it('atomically records an authenticated mock callback and queues one refresh', async () => {
    const receipt = await inbox.receive(
      {
        event_id: 'mock-event-1',
        event: 'deal.update',
        portal_key: 'mock-portal',
        deal_id: '42',
        timestamp: '2026-10-08T12:00:00.000Z',
      },
      { 'x-mock-bitrix-secret': 'mock-bitrix-event-secret-for-tests' },
    );

    expect(receipt).toEqual({ eventId: 'event-1', operationId: 'operation-1', duplicate: false });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(events.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'bitrix24',
        providerMode: 'mock',
        eventKey: 'mock-event-1',
        eventType: 'deal.update',
      }),
      expect.any(Object),
    );
    const stored = events.accept.mock.calls[0]?.[0] as { rawBody: Buffer; payload: object };
    expect(stored.rawBody.toString()).not.toContain('secret');
    expect(stored.payload).not.toHaveProperty('fields');
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wrong token', { 'x-mock-bitrix-secret': 'wrong' }, 'mock-portal'],
    ['wrong portal', { 'x-mock-bitrix-secret': 'mock-bitrix-event-secret-for-tests' }, 'other'],
  ])('rejects %s before persistence', async (_name, headers, portalKey) => {
    await expect(
      inbox.receive(
        {
          event_id: 'mock-event-1',
          event: 'deal.update',
          portal_key: portalKey,
          deal_id: '42',
          timestamp: '2026-10-08T12:00:00.000Z',
        },
        headers,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong token', 'wrong-token', 'crm.example.test', 'member-1'],
    ['wrong domain', 'app-token', 'attacker.example.test', 'member-1'],
    ['wrong member', 'app-token', 'crm.example.test', 'member-2'],
  ])(
    'rejects OAuth callback with %s before persistence',
    async (_name, token, domain, memberId) => {
      process.env.BITRIX_INTEGRATION_MODE = 'real';
      api.mode = 'oauth';
      api.verifyApplicationToken.mockImplementation((candidate: string) =>
        Promise.resolve(candidate === 'app-token'),
      );
      installations.findCurrent.mockResolvedValue({
        id: 'install-1',
        memberId: 'member-1',
        domain: 'crm.example.test',
        applicationToken: 'app-token',
      });
      const body = Buffer.from(
        `event=ONCRMDEALUPDATE&data%5BFIELDS%5D%5BID%5D=42&ts=1736405807&auth%5Bdomain%5D=${domain}&auth%5Bmember_id%5D=${memberId}&auth%5Bapplication_token%5D=${token}`,
      );
      await expect(inbox.receive(body, {})).rejects.toMatchObject({ status: 401 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('accepts an OAuth event only after installation token, domain, and member all match', async () => {
    process.env.BITRIX_INTEGRATION_MODE = 'real';
    api.mode = 'oauth';
    api.verifyApplicationToken.mockResolvedValue(true);
    installations.findCurrent.mockResolvedValue({
      id: 'install-1',
      memberId: 'member-1',
      domain: 'crm.example.test',
      applicationToken: 'app-token',
    });
    const body = Buffer.from(
      'event=ONCRMDEALUPDATE&data%5BFIELDS%5D%5BID%5D=42&ts=1736405807&auth%5Bdomain%5D=crm.example.test&auth%5Bmember_id%5D=member-1&auth%5Bapplication_token%5D=app-token',
    );
    await expect(inbox.receive(body, {})).resolves.toMatchObject({ duplicate: false });
    expect(api.verifyApplicationToken).toHaveBeenCalledWith('app-token');
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('does not accept a mock envelope in real webhook mode even with the outgoing credential', async () => {
    process.env.BITRIX_INTEGRATION_MODE = 'real';
    process.env.TIKTOK_BITRIX24_WEBHOOK_URL = 'https://crm.example.test/rest/';
    process.env.TIKTOK_BITRIX24_OUTGOING_TOKEN = 'outgoing-event-secret-for-test';
    api.mode = 'webhook';
    await expect(
      inbox.receive(
        {
          event_id: 'mock-event-1',
          event: 'deal.update',
          portal_key: 'mock-portal',
          deal_id: '42',
          timestamp: '2026-10-08T12:00:00.000Z',
        },
        { 'x-bitrix-outgoing-token': 'outgoing-event-secret-for-test' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts an outgoing webhook by the application token Bitrix24 sends in the body', async () => {
    process.env.BITRIX_INTEGRATION_MODE = 'real';
    process.env.TIKTOK_BITRIX24_WEBHOOK_URL = 'https://crm.example.test/rest/';
    process.env.TIKTOK_BITRIX24_OUTGOING_TOKEN = 'outgoing-event-secret-for-test';
    api.mode = 'webhook';
    const body = (token: string) =>
      Buffer.from(
        `event=ONCRMDEALUPDATE&data%5BFIELDS%5D%5BID%5D=42&ts=1736405807&auth%5Bdomain%5D=crm.example.test&auth%5Bmember_id%5D=member-1&auth%5Bapplication_token%5D=${token}`,
      );

    await expect(inbox.receive(body('some-other-token-of-16-chars'), {})).rejects.toMatchObject({
      status: 401,
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    await expect(inbox.receive(body('outgoing-event-secret-for-test'), {})).resolves.toMatchObject({
      duplicate: false,
    });
  });
});
