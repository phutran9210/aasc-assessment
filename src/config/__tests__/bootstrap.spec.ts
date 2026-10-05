import { Controller, Get, Logger, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import request from 'supertest';

import type { AppConfig } from '../app.config.js';
import {
  setupCors,
  setupGracefulShutdown,
  setupSecurity,
  setupSwagger,
  SHUTDOWN_TIMEOUT_MS,
} from '../bootstrap.js';

@Controller('ping')
class PingController {
  @Get()
  ping(): { pong: boolean } {
    return { pong: true };
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

const baseConfig: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  isProduction: false,
  corsOrigins: '*',
  swaggerEnabled: true,
};

async function createApp(
  setup: (app: NestExpressApplication) => void,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [PingModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useLogger(false);
  setup(app);
  await app.init();
  return app;
}

describe('bootstrap', () => {
  let app: NestExpressApplication | undefined;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('setupCors', () => {
    it('should allow any origin without credentials when corsOrigins is "*"', async () => {
      app = await createApp((instance) => setupCors(instance, baseConfig));

      const response = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://anything.example.com');

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('should echo an allowed origin with credentials when corsOrigins is a list', async () => {
      const config = { ...baseConfig, corsOrigins: ['https://app.example.com'] };
      app = await createApp((instance) => setupCors(instance, config));

      const response = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://app.example.com');

      expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should not send the allow-origin header when the origin is not in the list', async () => {
      const config = { ...baseConfig, corsOrigins: ['https://app.example.com'] };
      app = await createApp((instance) => setupCors(instance, config));

      const response = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://evil.example.com');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('setupSecurity', () => {
    it('should add security headers and hide the framework when applied', async () => {
      app = await createApp((instance) => setupSecurity(instance));

      const response = await request(app.getHttpServer()).get('/ping').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).not.toContain(
        'upgrade-insecure-requests',
      );
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('setupSwagger', () => {
    it('should serve the OpenAPI document when swagger is enabled', async () => {
      app = await createApp((instance) => setupSwagger(instance, baseConfig));

      const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

      expect(response.body.paths).toHaveProperty('/ping');
      expect(response.body.components.securitySchemes).toHaveProperty('bearer');
    });

    it('should not expose the docs when swagger is disabled', async () => {
      const config = { ...baseConfig, swaggerEnabled: false };
      app = await createApp((instance) => setupSwagger(instance, config));

      await request(app.getHttpServer()).get('/docs-json').expect(404);
      await request(app.getHttpServer()).get('/docs').expect(404);
    });
  });

  describe('setupGracefulShutdown', () => {
    it('should enable shutdown hooks and force exit when shutdown hangs past the timeout', async () => {
      jest.useFakeTimers();
      const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const handlers = new Map<string | symbol, () => void>();
      jest.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return process;
      }) as never);
      const moduleRef = await Test.createTestingModule({ imports: [PingModule] }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      const enableShutdownHooks = jest.spyOn(app, 'enableShutdownHooks').mockReturnValue(app);

      setupGracefulShutdown(app);
      handlers.get('SIGTERM')?.();

      expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
      expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
      jest.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
