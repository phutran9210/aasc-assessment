import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

import { lastValueFrom, of, throwError } from 'rxjs';

import { LoggingInterceptor } from '../logging.interceptor.js';

function createContext(type: 'http' | 'ws' = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/health', url: '/health?code=secret' }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let log: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('intercept', () => {
    it('should log method, url, status and duration when the handler succeeds', async () => {
      const next: CallHandler = { handle: () => of({ ok: true }) };

      const result = await lastValueFrom(interceptor.intercept(createContext(), next));

      expect(result).toEqual({ ok: true });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^GET \/health 200 \+\d+ms$/));
    });

    it('should leave the query string out of the log when the url carries one', async () => {
      const next: CallHandler = { handle: () => of(null) };

      await lastValueFrom(interceptor.intercept(createContext(), next));

      expect(log).toHaveBeenCalledWith(expect.not.stringContaining('secret'));
    });

    it('should not log when the handler throws', async () => {
      const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

      await expect(lastValueFrom(interceptor.intercept(createContext(), next))).rejects.toThrow(
        'boom',
      );
      expect(log).not.toHaveBeenCalled();
    });

    it('should pass through without logging when the context is not HTTP', async () => {
      const next: CallHandler = { handle: () => of('pong') };

      const result = await lastValueFrom(interceptor.intercept(createContext('ws'), next));

      expect(result).toBe('pong');
      expect(log).not.toHaveBeenCalled();
    });
  });
});
