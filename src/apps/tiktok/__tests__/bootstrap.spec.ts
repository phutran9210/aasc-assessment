import { NestFactory } from '@nestjs/core';
import { createTiktokApp } from '../bootstrap.js';

describe('createTiktokApp', () => {
  const envBefore = process.env.CORS_ORIGINS;
  afterEach(() => {
    jest.restoreAllMocks();
    if (envBefore === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = envBefore;
  });

  it('creates an app with raw webhook bodies, security middleware and configured CORS', async () => {
    const app = {
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalInterceptors: jest.fn(),
      enableCors: jest.fn(),
    };
    const create = jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);
    process.env.CORS_ORIGINS = 'https://admin.example, https://ops.example';
    await expect(createTiktokApp(class DummyModule {})).resolves.toBe(app);
    expect(create).toHaveBeenCalledWith(expect.any(Function), { rawBody: true, bodyParser: false });
    expect(app.use).toHaveBeenCalledTimes(3);
    expect(app.enableCors).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['https://admin.example', 'https://ops.example'],
        exposedHeaders: ['ETag'],
      }),
    );
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.useGlobalInterceptors).toHaveBeenCalledTimes(1);
  });

  it('allows all origins when explicitly configured', async () => {
    const app = {
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalInterceptors: jest.fn(),
      enableCors: jest.fn(),
    };
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);
    process.env.CORS_ORIGINS = '*';
    await createTiktokApp();
    expect(app.enableCors).toHaveBeenCalledWith(expect.objectContaining({ origin: '*' }));
  });
});
