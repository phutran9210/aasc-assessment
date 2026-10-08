import { validateTiktokEnv } from '../env.validation.js';

describe('validateTiktokEnv', () => {
  it('rejects missing PostgreSQL configuration and invalid secrets', () => {
    expect(() =>
      validateTiktokEnv({
        DATABASE_PATH: ':memory:',
        TIKTOK_JWT_SECRET: 'short',
      }),
    ).toThrow();
  });

  it('uses a separate app port and accepts mock mode with valid configuration', () => {
    const config = validateTiktokEnv({
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

    expect(config.port).toBe(3001);
    expect(config.databaseUrl).toBe('postgres://test:test@localhost:5432/tiktok');
    expect(config.tiktokMode).toBe('mock');
  });
});
