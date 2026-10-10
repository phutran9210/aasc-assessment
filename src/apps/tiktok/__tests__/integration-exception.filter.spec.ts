import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { IntegrationExceptionFilter } from '../integration-exception.filter.js';

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path: '/webhooks/tiktok/leads',
        url: '/webhooks/tiktok/leads',
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('IntegrationExceptionFilter', () => {
  const filter = new IntegrationExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers a report carried by an exception with the report itself', () => {
    const { host, status, json } = createHost();
    const report = { status: 'unavailable', checks: { database: 'ok', redis: 'down' } };

    filter.catch(new ServiceUnavailableException(report), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(report);
  });

  it('keeps the client status of a body parser failure', () => {
    const { host, status, json } = createHost();

    filter.catch(Object.assign(new Error('request entity too large'), { status: 413 }), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 413, error: 'Payload Too Large' }),
    );
  });

  it('uses the shared error shape for everything else', () => {
    const { host, status, json } = createHost();

    filter.catch(new BadRequestException('Invalid TikTok webhook envelope'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid TikTok webhook envelope',
        path: '/webhooks/tiktok/leads',
      }),
    );

    filter.catch(Object.assign(new Error('database exploded'), { status: 500 }), host);
    expect(status).toHaveBeenLastCalledWith(500);
  });
});
