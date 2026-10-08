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
// Blank = unset, and it wins over a developer's real .env: the lead sync e2e needs an app that
// is not configured, and the Bitrix24 e2e must stay in OAuth mode.
process.env.GOOGLE_SHEET_ID = '';
process.env.BITRIX24_WEBHOOK_URL = '';
process.env.LEAD_SYNC_MAPPING_PATH = 'config/mapping.json';
process.env.LEAD_SYNC_TIMEZONE = 'Asia/Ho_Chi_Minh';
// A schedule is configured on purpose: e2e proves it is not started outside main.ts.
process.env.LEAD_SYNC_CRON = '*/15 * * * *';
// No backoff waits in e2e.
process.env.LEAD_SYNC_MAX_RETRIES = '0';
// One-way by default: a developer's .env may turn two-way sync on.
process.env.LEAD_SYNC_DIRECTION = 'sheet-to-bitrix';
process.env.APP_PUBLIC_URL = '';
process.env.BITRIX24_OUTGOING_TOKEN = '';
