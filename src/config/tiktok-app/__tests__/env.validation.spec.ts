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
      BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
    });

    expect(config.port).toBe(3001);
    expect(config.databaseUrl).toBe('postgres://test:test@localhost:5432/tiktok');
    expect(config.tiktokMode).toBe('mock');
  });

  it('treats a blank Bitrix webhook URL and outgoing token as not set', () => {
    const config = validateTiktokEnv({
      TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
      TIKTOK_REDIS_URL: 'redis://localhost:6379',
      TIKTOK_JWT_SECRET: 'a'.repeat(32),
      TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
      TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
      BITRIX_INTEGRATION_MODE: 'real',
      TIKTOK_ADVERTISER_ID: 'advertiser-test',
      TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
      BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
      TIKTOK_BITRIX24_WEBHOOK_URL: '  ',
      TIKTOK_BITRIX24_OUTGOING_TOKEN: '',
    });

    expect(config.bitrixMode).toBe('real');
  });

  it('requires a separate outgoing callback credential for a real Bitrix webhook connection', () => {
    expect(() =>
      validateTiktokEnv({
        TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
        TIKTOK_REDIS_URL: 'redis://localhost:6379',
        TIKTOK_JWT_SECRET: 'a'.repeat(32),
        TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
        TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
        TIKTOK_MODE: 'mock',
        BITRIX_INTEGRATION_MODE: 'real',
        TIKTOK_ADVERTISER_ID: 'advertiser-test',
        TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
        BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
        TIKTOK_BITRIX24_WEBHOOK_URL: 'https://example.test/rest/',
      }),
    ).toThrow('TIKTOK_BITRIX24_OUTGOING_TOKEN');
  });

  it('allows real Bitrix mode in production through a webhook, the only path verified live', () => {
    const env = {
      NODE_ENV: 'production',
      TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
      TIKTOK_REDIS_URL: 'redis://localhost:6379',
      TIKTOK_JWT_SECRET: 'a'.repeat(32),
      TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
      TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
      TIKTOK_MODE: 'mock',
      BITRIX_INTEGRATION_MODE: 'real',
      TIKTOK_ADVERTISER_ID: 'advertiser-test',
      TIKTOK_WEBHOOK_SECRET: 'mock-webhook-secret',
      BITRIX_MOCK_EVENT_SECRET: 'mock-bitrix-event-secret-for-tests',
      CORS_ORIGINS: 'https://admin.example.test',
    };

    expect(() => validateTiktokEnv(env)).toThrow('BITRIX_INTEGRATION_MODE');
    expect(
      validateTiktokEnv({
        ...env,
        TIKTOK_BITRIX24_WEBHOOK_URL: 'https://portal.example.test/rest/1/token/',
        TIKTOK_BITRIX24_OUTGOING_TOKEN: 'outgoing-token-of-16-chars',
      }).bitrixMode,
    ).toBe('real');
    expect(validateTiktokEnv({ ...env, NODE_ENV: 'development' }).bitrixMode).toBe('real');
  });

  describe('production', () => {
    const production = {
      NODE_ENV: 'production',
      TIKTOK_DATABASE_URL: 'postgres://test:test@localhost:5432/tiktok',
      TIKTOK_REDIS_URL: 'redis://localhost:6379',
      TIKTOK_JWT_SECRET: 'j'.repeat(48),
      TIKTOK_JWT_ISSUER: 'aasc-tiktok',
      TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-clients',
      TIKTOK_ADVERTISER_ID: 'advertiser-1',
      TIKTOK_WEBHOOK_SECRET: 'w'.repeat(32),
      BITRIX_MOCK_EVENT_SECRET: 'b'.repeat(32),
      CORS_ORIGINS: 'https://admin.example.test',
    };

    it('accepts a configuration with real secrets and an origin allowlist', () => {
      expect(validateTiktokEnv(production).corsOrigins).toEqual(['https://admin.example.test']);
    });

    it.each(['TIKTOK_JWT_SECRET', 'TIKTOK_WEBHOOK_SECRET', 'BITRIX_MOCK_EVENT_SECRET'])(
      'refuses the placeholder value of %s from the example file',
      (key) => {
        expect(() =>
          validateTiktokEnv({ ...production, [key]: `change-me-${'x'.repeat(40)}` }),
        ).toThrow(key);
      },
    );

    it('refuses to allow every origin', () => {
      expect(() => validateTiktokEnv({ ...production, CORS_ORIGINS: '*' })).toThrow('CORS_ORIGINS');
      const withoutOrigins: Record<string, string> = { ...production };
      delete withoutOrigins.CORS_ORIGINS;
      expect(() => validateTiktokEnv(withoutOrigins)).toThrow('CORS_ORIGINS');
    });

    it('keeps placeholders and the wildcard usable outside production', () => {
      expect(
        validateTiktokEnv({
          ...production,
          NODE_ENV: 'development',
          TIKTOK_JWT_SECRET: `change-me-${'x'.repeat(40)}`,
          CORS_ORIGINS: '*',
        }).corsOrigins,
      ).toBe('*');
    });
  });
});
