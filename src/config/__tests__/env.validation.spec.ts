import { validateEnv } from '../env.validation.js';

describe('validateEnv', () => {
  it('should apply defaults when no variable is set', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_PATH: 'data/app.sqlite',
      DATABASE_SYNCHRONIZE: true,
      DATABASE_LOGGING: false,
      CORS_ORIGINS: '*',
      SWAGGER_ENABLED: true,
      JWT_SECRET: 'dev-only-jwt-secret-change-me',
      JWT_EXPIRES_IN_SECONDS: 86400,
      BCRYPT_ROUNDS: 10,
      BITRIX24_CLIENT_ID: undefined,
      BITRIX24_CLIENT_SECRET: undefined,
      BITRIX24_DOMAIN: undefined,
      BITRIX24_REQUISITE_PRESET_ID: undefined,
      JOTFORM_API_KEY: undefined,
      JOTFORM_FORM_ID: undefined,
      JOTFORM_WEBHOOK_SECRET: undefined,
      JOTFORM_API_BASE_URL: 'https://api.jotform.com',
    });
  });

  it('should coerce strings to typed values when variables come from .env', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_PATH: ' /var/data/app.sqlite ',
      DATABASE_SYNCHRONIZE: 'false',
      DATABASE_LOGGING: 'true',
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com ,',
      SWAGGER_ENABLED: 'false',
      JWT_SECRET: 'a-real-secret-for-production-use',
      JWT_EXPIRES_IN_SECONDS: '3600',
      BCRYPT_ROUNDS: '12',
      BITRIX24_CLIENT_ID: 'local.client',
      BITRIX24_CLIENT_SECRET: 'client-secret',
      BITRIX24_DOMAIN: 'portal.bitrix24.com',
      BITRIX24_REQUISITE_PRESET_ID: '1',
    });

    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      DATABASE_PATH: '/var/data/app.sqlite',
      DATABASE_SYNCHRONIZE: false,
      DATABASE_LOGGING: true,
      CORS_ORIGINS: ['https://a.example.com', 'https://b.example.com'],
      SWAGGER_ENABLED: false,
      JWT_SECRET: 'a-real-secret-for-production-use',
      JWT_EXPIRES_IN_SECONDS: 3600,
      BCRYPT_ROUNDS: 12,
      BITRIX24_CLIENT_ID: 'local.client',
      BITRIX24_CLIENT_SECRET: 'client-secret',
      BITRIX24_DOMAIN: 'portal.bitrix24.com',
      BITRIX24_REQUISITE_PRESET_ID: 1,
      JOTFORM_API_BASE_URL: 'https://api.jotform.com',
    });
  });

  it('should ignore unrelated variables when the environment has extra keys', () => {
    expect(validateEnv({ HOME: '/home/dev', PORT: '3001' })).not.toHaveProperty('HOME');
  });

  it.each([
    ['PORT', { PORT: 'abc' }],
    ['PORT', { PORT: '' }],
    ['PORT', { PORT: '70000' }],
    ['NODE_ENV', { NODE_ENV: 'staging' }],
    ['DATABASE_PATH', { DATABASE_PATH: '   ' }],
    ['DATABASE_SYNCHRONIZE', { DATABASE_SYNCHRONIZE: 'yes' }],
    ['CORS_ORIGINS', { CORS_ORIGINS: '' }],
    ['SWAGGER_ENABLED', { SWAGGER_ENABLED: '1' }],
    ['JWT_SECRET', { JWT_SECRET: 'too-short' }],
    ['JWT_SECRET', { NODE_ENV: 'production' }],
    ['JWT_EXPIRES_IN_SECONDS', { JWT_EXPIRES_IN_SECONDS: '10' }],
    ['BCRYPT_ROUNDS', { BCRYPT_ROUNDS: '3' }],
    ['BCRYPT_ROUNDS', { BCRYPT_ROUNDS: '16' }],
    ['BITRIX24_DOMAIN', { BITRIX24_DOMAIN: 'https://portal.bitrix24.com/rest/' }],
    ['BITRIX24_REQUISITE_PRESET_ID', { BITRIX24_REQUISITE_PRESET_ID: '0' }],
  ])('should name %s in the error when env is %o', (variable, raw) => {
    expect(() => validateEnv(raw)).toThrow(/Biến môi trường không hợp lệ/);
    expect(() => validateEnv(raw)).toThrow(new RegExp(variable));
  });

  it('should accept an unconfigured optional Bitrix integration when other environment is valid', () => {
    const env = validateEnv({});

    expect(env.BITRIX24_CLIENT_ID).toBeUndefined();
    expect(env.BITRIX24_CLIENT_SECRET).toBeUndefined();
    expect(env.BITRIX24_DOMAIN).toBeUndefined();
    expect(env.BITRIX24_REQUISITE_PRESET_ID).toBeUndefined();
  });

  it('should accept a valid Bitrix configuration', () => {
    const env = validateEnv({
      BITRIX24_CLIENT_ID: 'local.client',
      BITRIX24_CLIENT_SECRET: 'client-secret',
      BITRIX24_DOMAIN: 'portal.bitrix24.com',
      BITRIX24_REQUISITE_PRESET_ID: '1',
    });

    expect(env.BITRIX24_DOMAIN).toBe('portal.bitrix24.com');
    expect(env.BITRIX24_REQUISITE_PRESET_ID).toBe(1);
  });

  it('should accept Jotform settings and treat blank values as unset', () => {
    const env = validateEnv({
      JOTFORM_API_KEY: ' key-123 ',
      JOTFORM_FORM_ID: '252771234567890',
      JOTFORM_WEBHOOK_SECRET: 'a-long-shared-secret',
      JOTFORM_API_BASE_URL: 'https://eu-api.jotform.com',
    });
    expect(env).toMatchObject({
      JOTFORM_API_KEY: 'key-123',
      JOTFORM_FORM_ID: '252771234567890',
      JOTFORM_WEBHOOK_SECRET: 'a-long-shared-secret',
      JOTFORM_API_BASE_URL: 'https://eu-api.jotform.com',
    });

    expect(
      validateEnv({ JOTFORM_API_KEY: '', JOTFORM_FORM_ID: ' ', JOTFORM_API_BASE_URL: '' }),
    ).toMatchObject({
      JOTFORM_API_KEY: undefined,
      JOTFORM_FORM_ID: undefined,
      JOTFORM_API_BASE_URL: 'https://api.jotform.com',
    });
  });

  it('should reject a Jotform form id that is not numeric', () => {
    expect(() => validateEnv({ JOTFORM_FORM_ID: 'my-form' })).toThrow('JOTFORM_FORM_ID');
  });

  it('should reject a Jotform webhook secret shorter than 16 characters', () => {
    expect(() => validateEnv({ JOTFORM_WEBHOOK_SECRET: 'short' })).toThrow(
      'JOTFORM_WEBHOOK_SECRET',
    );
  });
});
