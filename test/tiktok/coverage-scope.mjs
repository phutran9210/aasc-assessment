/**
 * Code the TikTok integration is accountable for. Left out, as in the base config: composition
 * (`*.module.ts`, `index.ts`), process entry points and command line launchers, migrations (SQL
 * exercised by every integration run) and the in-repo provider mock, which is a test double.
 */
export const TIKTOK_COVERAGE_SCOPE = [
  'src/apps/tiktok/**/*.ts',
  'src/config/tiktok-app/**/*.ts',
  'src/core/queue/**/*.ts',
  'src/common/logging/**/*.ts',
  'src/modules/crm-integration/**/*.ts',
  'src/modules/tiktok/**/*.ts',
  'src/modules/integration-auth/**/*.ts',
  'src/modules/integration-analytics/**/*.ts',
  'src/modules/integration-reports/**/*.ts',
  '!src/**/__tests__/**',
  '!src/**/index.ts',
  '!src/**/*.module.ts',
  '!src/apps/tiktok/{main,worker,bootstrap}.ts',
  '!src/apps/tiktok/cli/{mock-server,run-demo,send-webhook,load-probe,export-openapi,seed}.ts',
  '!src/apps/tiktok/database/{migration-runner,data-source}.ts',
  '!src/apps/tiktok/database/migrations/**',
  '!src/modules/tiktok/testing/**',
];
