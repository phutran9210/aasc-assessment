import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BITRIX_CONFIG } from '../ports/bitrix-config.port.js';
import { BITRIX_INSTALLATION_STORE } from '../ports/bitrix-installation-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '../ports/bitrix-request-limiter.port.js';
import { BitrixApiService } from '../services/bitrix-api.service.js';
import { BitrixHttpError, BitrixHttpTransport } from '../services/bitrix-http-transport.service.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';
import { BitrixRateLimiter } from '../services/bitrix-rate-limiter.service.js';

describe('BitrixApiService', () => {
  const installation = {
    clientEndpoint: 'https://portal.bitrix24.com/rest/',
    accessToken: 'token',
  };
  const WEBHOOK = 'https://portal.bitrix24.com/rest/1/abcdef0123456789/';
  const repository = { findCurrent: jest.fn() };
  const oauth = { getAccessToken: jest.fn(), refreshAccessToken: jest.fn() };
  const transport = { postRest: jest.fn() };
  let service: BitrixApiService;

  const build = async (webhookUrl?: string): Promise<BitrixApiService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BitrixApiService,
        { provide: BITRIX_REQUEST_LIMITER, useValue: new BitrixRateLimiter() },
        { provide: BITRIX_INSTALLATION_STORE, useValue: repository },
        { provide: BitrixOAuthService, useValue: oauth },
        { provide: BitrixHttpTransport, useValue: transport },
        { provide: BITRIX_CONFIG, useValue: { webhookUrl } },
      ],
    }).compile();
    return moduleRef.get(BitrixApiService);
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    repository.findCurrent.mockResolvedValue(installation);
    oauth.getAccessToken.mockResolvedValue('token');
    service = await build();
  });

  it('calls the configured Bitrix endpoint with a current token', async () => {
    transport.postRest.mockResolvedValue({ result: { id: 1 } });

    await expect(service.callBitrixApi('crm.item.get', { id: 1 })).resolves.toEqual({ id: 1 });
    expect(transport.postRest).toHaveBeenCalledWith(
      installation.clientEndpoint,
      'crm.item.get',
      { id: 1 },
      'token',
      undefined,
    );
  });

  it('returns the list total reported next to result', async () => {
    transport.postRest.mockResolvedValue({ result: { items: [] }, total: 7 });

    await expect(service.callBitrixApiWithTotal('crm.item.list', {})).resolves.toEqual({
      result: { items: [] },
      total: 7,
    });
  });

  it('rejects calls before installation and maps responses without a result', async () => {
    repository.findCurrent.mockResolvedValueOnce(null);
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    transport.postRest.mockResolvedValueOnce({});
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('refreshes once and retries an expired-token response', async () => {
    transport.postRest
      .mockRejectedValueOnce(new BitrixHttpError('expired', 'expired_token', 401))
      .mockResolvedValueOnce({ result: { id: 1 } });
    oauth.refreshAccessToken.mockResolvedValue('new-token');

    await expect(service.callBitrixApi('crm.item.get', { id: 1 })).resolves.toEqual({ id: 1 });
    expect(oauth.refreshAccessToken).toHaveBeenCalledTimes(1);
    // The rejected token is handed over so a refresh that already happened is not repeated.
    expect(oauth.refreshAccessToken).toHaveBeenCalledWith('token');
  });

  it('refreshes when Bitrix24 rejects the token as invalid_token', async () => {
    transport.postRest
      .mockRejectedValueOnce(
        new BitrixHttpError('Unable to get application by token', 'invalid_token', 401),
      )
      .mockResolvedValueOnce({ result: { id: 1 } });
    oauth.refreshAccessToken.mockResolvedValue('new-token');

    await expect(service.callBitrixApi('crm.item.get', { id: 1 })).resolves.toEqual({ id: 1 });
    expect(oauth.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  describe('rate limit', () => {
    const limited = () => new BitrixHttpError('Too many requests', 'QUERY_LIMIT_EXCEEDED', 503);

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('waits and retries when Bitrix24 answers QUERY_LIMIT_EXCEEDED', async () => {
      transport.postRest
        .mockRejectedValueOnce(limited())
        .mockRejectedValueOnce(limited())
        .mockResolvedValueOnce({ result: { id: 1 } });

      const call = service.callBitrixApi('crm.item.get', { id: 1 });
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(call).resolves.toEqual({ id: 1 });
      expect(transport.postRest).toHaveBeenCalledTimes(3);
      expect(oauth.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('does not retry rate limits when the caller owns retry policy', async () => {
      const failure = limited();
      transport.postRest.mockRejectedValueOnce(failure);

      await expect(service.callRaw('crm.item.list', {}, { retryRateLimit: false })).rejects.toBe(
        failure,
      );
      expect(transport.postRest).toHaveBeenCalledTimes(1);
    });

    it('answers 429 when the limit is still exceeded after the last retry', async () => {
      transport.postRest.mockRejectedValue(limited());

      const call = service.callBitrixApi('crm.item.get', { id: 1 });
      const outcome = expect(call).rejects.toMatchObject({ status: 429 });
      await jest.advanceTimersByTimeAsync(60_000);

      await outcome;
      expect(transport.postRest).toHaveBeenCalledTimes(4);
    });
  });

  it('maps a Bitrix NOT_FOUND error to 404', async () => {
    transport.postRest.mockRejectedValueOnce(
      new BitrixHttpError('Item not found', 'NOT_FOUND', 400),
    );

    await expect(service.callBitrixApi('crm.item.get', { id: 9 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps timeout and transport failures to safe HTTP errors', async () => {
    transport.postRest.mockRejectedValueOnce(
      new BitrixHttpError('timeout', undefined, undefined, true),
    );
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    transport.postRest.mockRejectedValueOnce(new BitrixHttpError('upstream', 'E', 500));
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('preserves existing HTTP errors and maps unknown transport errors safely', async () => {
    const existing = new BadGatewayException('already mapped');
    transport.postRest.mockRejectedValueOnce(existing);
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBe(existing);

    transport.postRest.mockRejectedValueOnce('socket failed');
    await expect(service.callBitrixApi('crm.item.get', {})).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  describe('callRaw', () => {
    it('keeps the Bitrix24 error instead of mapping it to an HTTP error', async () => {
      const failure = new BitrixHttpError('Invalid value', 'INVALID_ARG_VALUE', 400);
      transport.postRest.mockRejectedValueOnce(failure);

      await expect(service.callRaw('crm.item.add', {})).rejects.toBe(failure);
    });

    it('does not retry a timeout unless asked to', async () => {
      transport.postRest.mockRejectedValue(
        new BitrixHttpError('timeout', undefined, undefined, true),
      );

      await expect(service.callRaw('batch', {})).rejects.toMatchObject({ timeout: true });
      expect(transport.postRest).toHaveBeenCalledTimes(1);
    });

    it('passes a per-call timeout to the transport', async () => {
      transport.postRest.mockResolvedValue({ result: {} });

      await service.callRaw('batch', { halt: 0 }, { timeoutMs: 60_000 });

      expect(transport.postRest).toHaveBeenCalledWith(
        installation.clientEndpoint,
        'batch',
        { halt: 0 },
        'token',
        60_000,
      );
    });

    describe('with retryTransient', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('retries a timeout, a network failure and a 5xx, then succeeds', async () => {
        transport.postRest
          .mockRejectedValueOnce(new BitrixHttpError('timeout', undefined, undefined, true))
          .mockRejectedValueOnce(new BitrixHttpError('unreachable', undefined, undefined))
          .mockRejectedValueOnce(new BitrixHttpError('boom', 'INTERNAL_SERVER_ERROR', 500))
          .mockResolvedValueOnce({ result: { fields: {} } });

        const call = service.callRaw(
          'crm.item.fields',
          {},
          { retryTransient: true, maxRetries: 4 },
        );
        await jest.advanceTimersByTimeAsync(60_000);

        await expect(call).resolves.toEqual({ result: { fields: {} }, total: undefined });
        expect(transport.postRest).toHaveBeenCalledTimes(4);
      });

      it('gives up after maxRetries and throws the last Bitrix24 error', async () => {
        transport.postRest.mockRejectedValue(new BitrixHttpError('boom', undefined, 502));

        const call = service.callRaw('crm.item.list', {}, { retryTransient: true, maxRetries: 2 });
        const outcome = expect(call).rejects.toMatchObject({ status: 502 });
        await jest.advanceTimersByTimeAsync(60_000);

        await outcome;
        expect(transport.postRest).toHaveBeenCalledTimes(3);
      });

      it('never retries a rejected request or OPERATION_TIME_LIMIT', async () => {
        transport.postRest.mockRejectedValueOnce(
          new BitrixHttpError('bad', 'INVALID_REQUEST', 400),
        );
        await expect(
          service.callRaw('crm.item.list', {}, { retryTransient: true }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

        transport.postRest.mockRejectedValueOnce(
          new BitrixHttpError('too slow', 'OPERATION_TIME_LIMIT', 503),
        );
        await expect(
          service.callRaw('crm.item.list', {}, { retryTransient: true }),
        ).rejects.toMatchObject({ code: 'OPERATION_TIME_LIMIT' });

        expect(transport.postRest).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('webhook mode', () => {
    beforeEach(async () => {
      service = await build(WEBHOOK);
    });

    it('calls the webhook URL without a token and without touching the OAuth installation', async () => {
      transport.postRest.mockResolvedValue({ result: { id: 1 } });

      await expect(service.callBitrixApi('crm.item.get', { id: 1 })).resolves.toEqual({ id: 1 });
      expect(transport.postRest).toHaveBeenCalledWith(
        WEBHOOK,
        'crm.item.get',
        { id: 1 },
        undefined,
        undefined,
      );
      expect(repository.findCurrent).not.toHaveBeenCalled();
      expect(oauth.getAccessToken).not.toHaveBeenCalled();
    });

    it('does not try to refresh a token when the webhook is rejected', async () => {
      transport.postRest.mockRejectedValue(new BitrixHttpError('bad', 'INVALID_CREDENTIALS', 401));

      await expect(service.callRaw('crm.item.get', {})).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(oauth.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('never puts the webhook URL in the error it reports', async () => {
      transport.postRest.mockRejectedValue(new BitrixHttpError('upstream', 'E', 500));

      await expect(service.callBitrixApi('crm.item.get', {})).rejects.toMatchObject({
        message: expect.not.stringContaining('abcdef0123456789'),
      });
    });
  });

  describe('isConfigured / mode', () => {
    it('reports webhook mode as configured', async () => {
      const webhook = await build(WEBHOOK);

      expect(webhook.mode).toBe('webhook');
      await expect(webhook.isConfigured()).resolves.toBe(true);
    });

    it('reports OAuth mode as configured only once the application is installed', async () => {
      expect(service.mode).toBe('oauth');
      await expect(service.isConfigured()).resolves.toBe(true);

      repository.findCurrent.mockResolvedValue(null);
      await expect(service.isConfigured()).resolves.toBe(false);
    });
  });

  describe('verifyApplicationToken', () => {
    it('accepts only the application token stored at install time', async () => {
      repository.findCurrent.mockResolvedValue({ applicationToken: 'app-token' });

      await expect(service.verifyApplicationToken('app-token')).resolves.toBe(true);
      await expect(service.verifyApplicationToken('app-tokeN')).resolves.toBe(false);
      await expect(service.verifyApplicationToken('')).resolves.toBe(false);
    });

    it('accepts nothing while the application is not installed', async () => {
      repository.findCurrent.mockResolvedValue(null);

      await expect(service.verifyApplicationToken('app-token')).resolves.toBe(false);
    });
  });
});

describe('BitrixApiService logging', () => {
  const WEBHOOK = 'https://portal.bitrix24.com/rest/1/abcdef0123456789/';

  it('sanitizes the upstream reason before it reaches any logger', async () => {
    const { BITRIX_LOGGER } = await import('../ports/bitrix-logger.port.js');
    const entries: Array<{ level: string; message: string; detail?: unknown }> = [];
    const transport = { postRest: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BitrixApiService,
        { provide: BITRIX_REQUEST_LIMITER, useValue: new BitrixRateLimiter() },
        { provide: BITRIX_INSTALLATION_STORE, useValue: { findCurrent: jest.fn() } },
        { provide: BitrixOAuthService, useValue: {} },
        { provide: BitrixHttpTransport, useValue: transport },
        { provide: BITRIX_CONFIG, useValue: { webhookUrl: WEBHOOK } },
        {
          provide: BITRIX_LOGGER,
          useValue: {
            warn: (message: string, detail?: unknown) =>
              entries.push({ level: 'warn', message, detail }),
            error: (message: string, detail?: unknown) =>
              entries.push({ level: 'error', message, detail }),
          },
        },
      ],
    }).compile();
    transport.postRest.mockRejectedValue(
      new BitrixHttpError(
        `POST ${WEBHOOK}crm.item.add?auth=SECRETAUTH rejected lead person@example.com +84901234567`,
        'ACCESS_DENIED',
        403,
      ),
    );

    await expect(
      moduleRef.get(BitrixApiService).callBitrixApi('crm.item.add', {}),
    ).rejects.toBeInstanceOf(BadGatewayException);

    const logged = JSON.stringify(entries);
    expect(entries).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'crm.item.add failed',
        detail: expect.objectContaining({ errorCode: 'ACCESS_DENIED', status: 403 }),
      }),
    ]);
    for (const secret of ['abcdef0123456789', 'SECRETAUTH', 'person@example.com', '+84901234567']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('falls back to a Nest logger that prints the same sanitized detail', async () => {
    const { NestBitrixLogger } = await import('../ports/bitrix-logger.port.js');
    const { Logger } = await import('@nestjs/common');
    const lines: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    new NestBitrixLogger('Probe').error('crm.item.get failed', {
      reason: 'gateway said no',
      errorCode: 'INTERNAL',
      status: 502,
    });
    spy.mockRestore();

    expect(lines).toEqual([
      'crm.item.get failed: gateway said no (errorCode=INTERNAL, status=502)',
    ]);
  });
});
