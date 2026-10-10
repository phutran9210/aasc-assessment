import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { HttpExceptionFilter } from '../http-exception.filter.js';

type MockHost = {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
};

function createHost(method = 'GET', path = '/contacts/1', query = ''): MockHost {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method, path, url: `${path}${query}` }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('catch', () => {
    it('should return the exception status and message when an HttpException is thrown', () => {
      const { host, status, json } = createHost();

      filter.catch(new NotFoundException('Contact không tồn tại'), host);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({
        statusCode: 404,
        error: 'Not Found',
        message: 'Contact không tồn tại',
        path: '/contacts/1',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      });
    });

    it('should keep the stable error code when the exception carries one', () => {
      const { host, json } = createHost('GET', '/api/v1/reports/export');

      filter.catch(
        new BadRequestException({ code: 'EXPORT_REQUIRES_ASYNC', message: 'Too many rows' }),
        host,
      );

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'EXPORT_REQUIRES_ASYNC',
          message: 'Too many rows',
        }),
      );
    });

    it('should leave the code out when the exception has none', () => {
      const { host, json } = createHost();

      filter.catch(new NotFoundException('Contact không tồn tại'), host);

      expect(json.mock.calls[0][0]).not.toHaveProperty('code');
    });

    it('should keep every validation message when the exception carries an array', () => {
      const { host, json } = createHost('POST', '/contacts');

      filter.catch(new BadRequestException(['Email không hợp lệ', 'Tên là bắt buộc']), host);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
          message: ['Email không hợp lệ', 'Tên là bắt buộc'],
        }),
      );
    });

    it('should hide internal details when a non-HTTP error is thrown', () => {
      const { host, status, json } = createHost();

      filter.catch(new Error('SQLITE_BUSY: database is locked'), host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Lỗi hệ thống, vui lòng thử lại sau',
        }),
      );
    });

    it('should return 500 when a non-Error value is thrown', () => {
      const { host, status } = createHost();

      filter.catch('boom', host);

      expect(status).toHaveBeenCalledWith(500);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('GET /contacts/1 500'), 'boom');
    });

    it('should keep the query string out of the body and the log when the url carries one', () => {
      const { host, json } = createHost('GET', '/install', '?code=secret');

      filter.catch(new NotFoundException('x'), host);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ path: '/install' }));
      expect(warn).toHaveBeenCalledWith(expect.not.stringContaining('secret'));
    });

    it('should strip the query string from the message when the framework echoes the url', () => {
      const { host, json } = createHost('GET', '/nope', '?code=secret');

      filter.catch(new NotFoundException('Cannot GET /nope?code=secret'), host);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cannot GET /nope' }));
      expect(warn).toHaveBeenCalledWith(expect.not.stringContaining('secret'));
    });

    it('should notify the socket instead of writing an HTTP response when the context is ws', () => {
      const emit = jest.fn();
      const switchToHttp = jest.fn();
      const host = {
        getType: () => 'ws',
        switchToHttp,
        switchToWs: () => ({ getClient: () => ({ emit }) }),
      } as unknown as ArgumentsHost;

      filter.catch(new Error('gateway crashed'), host);

      expect(switchToHttp).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith('exception', {
        message: 'Lỗi hệ thống, vui lòng thử lại sau',
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('gateway crashed'),
        expect.any(String),
      );
    });

    it('should log 4xx as warn and 5xx as error with the stack trace', () => {
      const failure = new Error('db down');

      filter.catch(new NotFoundException('x'), createHost().host);
      filter.catch(failure, createHost().host);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('GET /contacts/1 404'));
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('500'), failure.stack);
    });
  });
});
