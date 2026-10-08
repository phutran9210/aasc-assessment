import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

describe('TikTok app boundary', () => {
  it('should reject old-app root imports and invalid TikTok configuration', async () => {
    Object.assign(process.env, {
      TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
      TIKTOK_REDIS_URL: 'redis://localhost:6379',
      TIKTOK_JWT_SECRET: 'a'.repeat(32),
      TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
      TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
      TIKTOK_MODE: 'mock',
      BITRIX_INTEGRATION_MODE: 'mock',
      TIKTOK_ADVERTISER_ID: 'advertiser-test',
      TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
      BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
    });
    const { TiktokAppModule } = await import('../app.module.js');
    const { TiktokWorkerModule } = await import('../worker.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [TiktokAppModule] })
      .overrideProvider(getDataSourceToken('tiktok'))
      .useValue(new DataSource({ type: 'postgres', url: process.env.TIKTOK_DATABASE_URL }))
      .compile();
    const app = moduleRef.createNestApplication();

    await app.init();
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
    await app.close();

    const imports = Reflect.getMetadata('imports', TiktokAppModule) as unknown[];
    const importedModuleNames = imports.map((entry) => (entry as { name?: string }).name);
    expect(importedModuleNames).not.toContain('AppModule');
    expect(importedModuleNames).not.toContain('DatabaseModule');

    const workerImports = Reflect.getMetadata('imports', TiktokWorkerModule) as unknown[];
    const workerModuleNames = workerImports.map((entry) => (entry as { name?: string }).name);
    expect(workerModuleNames).not.toContain('AppModule');
    expect(workerModuleNames).not.toContain('DatabaseModule');
  });
});
