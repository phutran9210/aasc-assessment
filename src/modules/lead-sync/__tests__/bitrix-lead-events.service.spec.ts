import type { LeadSyncConfig } from '@config/index.js';
import { BitrixHttpError } from '@modules/bitrix/index.js';
import type { BitrixApiService } from '@modules/bitrix/index.js';

import { Logger } from '@nestjs/common';

import { LeadSyncBusyError } from '../errors/index.js';
import { BitrixLeadEvents } from '../services/bitrix-lead-events.service.js';
import type { LeadPullback } from '../services/lead-pullback.service.js';

const event = (id: unknown, token = 'app-token', name = 'ONCRMLEADUPDATE') => ({
  event: name,
  data: { FIELDS: { ID: id } },
  auth: { application_token: token, domain: 'portal.bitrix24.vn' },
});

describe('BitrixLeadEvents', () => {
  const api = { verifyApplicationToken: jest.fn(), callRaw: jest.fn(), mode: 'oauth' };
  const pullback = { enabled: true, start: jest.fn() };
  let events: BitrixLeadEvents;

  const build = (overrides: Partial<LeadSyncConfig> = {}): BitrixLeadEvents =>
    new BitrixLeadEvents(
      api as unknown as BitrixApiService,
      pullback as unknown as LeadPullback,
      {
        publicUrl: 'https://app.example.com/',
        outgoingToken: undefined,
        eventDebounceMs: 2000,
        eventRetryMs: 5000,
        ...overrides,
      } as LeadSyncConfig,
    );

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    pullback.enabled = true;
    api.verifyApplicationToken.mockImplementation((token: string) =>
      Promise.resolve(token === 'app-token'),
    );
    pullback.start.mockResolvedValue({ run: { id: 'run-1' }, done: Promise.resolve({}) });
    events = build();
  });

  afterEach(() => {
    events.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('should pull the leads of several events of the same moment in one run', async () => {
    await events.receive(event('10'));
    await events.receive(event(12));
    await events.receive(event('10'));
    expect(pullback.start).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2000);

    expect(pullback.start).toHaveBeenCalledTimes(1);
    expect(pullback.start).toHaveBeenCalledWith([10, 12], 'webhook');
  });

  it('should refuse an event whose application token is not the one of this app', async () => {
    await expect(events.receive(event('10', 'forged'))).rejects.toThrow(
      'Sự kiện Bitrix24 có application_token không hợp lệ',
    );
    await jest.advanceTimersByTimeAsync(2000);

    expect(pullback.start).not.toHaveBeenCalled();
  });

  it('should accept the token of an outbound webhook configured by hand', async () => {
    events = build({ outgoingToken: 'manual-token' });

    await events.receive(event('10', 'manual-token'));
    await jest.advanceTimersByTimeAsync(2000);

    expect(api.verifyApplicationToken).not.toHaveBeenCalled();
    expect(pullback.start).toHaveBeenCalledWith([10], 'webhook');
  });

  it('should ignore other events, malformed IDs and everything while two-way sync is off', async () => {
    await events.receive(event('10', 'app-token', 'ONCRMLEADADD'));
    await events.receive(event('abc'));
    await events.receive({});
    pullback.enabled = false;
    await events.receive(event('10'));
    await jest.advanceTimersByTimeAsync(2000);

    expect(pullback.start).not.toHaveBeenCalled();
  });

  it('should try again later when another run holds the lock', async () => {
    pullback.start.mockRejectedValueOnce(new LeadSyncBusyError('run-0'));
    await events.receive(event('10'));

    await jest.advanceTimersByTimeAsync(2000);
    expect(pullback.start).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);

    expect(pullback.start).toHaveBeenCalledTimes(2);
    expect(pullback.start).toHaveBeenLastCalledWith([10], 'webhook');
  });

  it('should register the handler URL for lead updates', async () => {
    api.callRaw.mockResolvedValue({ result: true });

    await expect(events.register()).resolves.toEqual({
      event: 'ONCRMLEADUPDATE',
      handler: 'https://app.example.com/lead-sync/bitrix-events',
    });
    expect(api.callRaw).toHaveBeenCalledWith('event.bind', {
      event: 'ONCRMLEADUPDATE',
      handler: 'https://app.example.com/lead-sync/bitrix-events',
    });
  });

  it('should treat a handler that is already registered as success', async () => {
    api.callRaw.mockRejectedValue(new BitrixHttpError('Handler already binded', 'ERROR_CORE', 400));

    await expect(events.register()).resolves.toMatchObject({ event: 'ONCRMLEADUPDATE' });
  });

  it('should say what is missing when no public URL is configured', async () => {
    await expect(build({ publicUrl: undefined }).register()).rejects.toThrow(
      /^Chưa cấu hình APP_PUBLIC_URL/,
    );
  });
});
