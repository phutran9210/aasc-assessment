import { Test } from '@nestjs/testing';
import request from 'supertest';

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
    });
    const [{ AppModule }, { DatabaseModule }, { TiktokAppModule }] = await Promise.all([
      import('../../../app.module.js'),
      import('../../../core/database/database.module.js'),
      import('../app.module.js'),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [TiktokAppModule] }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
    await app.close();

    const imports = Reflect.getMetadata('imports', TiktokAppModule) as unknown[];
    expect(imports).not.toContain(AppModule);
    expect(imports).not.toContain(DatabaseModule);
  });
});
