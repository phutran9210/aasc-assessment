export const TIKTOK_TEST_ENV = {
  TIKTOK_JWT_SECRET: 'integration-test-jwt-secret-with-32-bytes',
  TIKTOK_JWT_ISSUER: 'aasc-tiktok-test',
  TIKTOK_JWT_AUDIENCE: 'aasc-tiktok-test-client',
  TIKTOK_MODE: 'mock',
  BITRIX_INTEGRATION_MODE: 'mock',
  TIKTOK_ADVERTISER_ID: 'advertiser-test',
  TIKTOK_WEBHOOK_SECRET: 'integration-test-webhook-secret',
} as const;
