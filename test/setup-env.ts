// Runs before any module is imported, so ConfigModule sees these values instead of `.env`.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.DATABASE_LOGGING = 'false';
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789';
// Lowest bcrypt cost: keeps the e2e suite fast.
process.env.BCRYPT_ROUNDS = '4';
// Jotform is replaced by test doubles in e2e; these only make the module "configured".
process.env.JOTFORM_API_KEY = 'test-jotform-api-key';
process.env.JOTFORM_FORM_ID = '252770000000001';
process.env.JOTFORM_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
