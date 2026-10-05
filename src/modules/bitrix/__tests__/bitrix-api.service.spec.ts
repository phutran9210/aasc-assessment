import { BadGatewayException, GatewayTimeoutException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BitrixInstallationRepository } from '../repositories/bitrix-installation.repository.js';
import { BitrixApiService } from '../services/bitrix-api.service.js';
import { BitrixHttpError, BitrixHttpTransport } from '../services/bitrix-http-transport.service.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';
import { BitrixRateLimiter } from '../services/bitrix-rate-limiter.service.js';

describe('BitrixApiService', () => {
  const installation = {
    clientEndpoint: 'https://portal.bitrix24.com/rest/',
    accessToken: 'token',
  };
  const repository = { findCurrent: jest.fn() };
  const oauth = { getAccessToken: jest.fn(), refreshAccessToken: jest.fn() };
  const transport = { postRest: jest.fn() };
  let service: BitrixApiService;

  beforeEach(async () => {
    jest.resetAllMocks();
    repository.findCurrent.mockResolvedValue(installation);
    oauth.getAccessToken.mockResolvedValue('token');
    const moduleRef = await Test.createTestingModule({
      providers: [
        BitrixApiService,
        BitrixRateLimiter,
        { provide: BitrixInstallationRepository, useValue: repository },
        { provide: BitrixOAuthService, useValue: oauth },
        { provide: BitrixHttpTransport, useValue: transport },
      ],
    }).compile();
    service = moduleRef.get(BitrixApiService);
  });

  it('calls the configured Bitrix endpoint with a current token', async () => {
    transport.postRest.mockResolvedValue({ result: { id: 1 } });

    await expect(service.callBitrixApi('crm.item.get', { id: 1 })).resolves.toEqual({ id: 1 });
    expect(transport.postRest).toHaveBeenCalledWith(
      installation.clientEndpoint,
      'crm.item.get',
      { id: 1 },
      'token',
    );
  });

  it('returns the list total reported next to result', async () => {
    transport.postRest.mockResolvedValue({ result: { items: [] }, total: 7 });

    await expect(service.callBitrixApiWithTotal('crm.item.list', {})).resolves.toEqual({
      result: { items: [] },
      total: 7,
    });
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
});
