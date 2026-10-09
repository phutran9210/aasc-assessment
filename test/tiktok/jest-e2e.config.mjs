import baseConfig from '../../jest.config.mjs';
import { TIKTOK_COVERAGE_SCOPE } from './coverage-scope.mjs';

export default {
  ...baseConfig,
  rootDir: '../..',
  roots: ['<rootDir>/test/tiktok'],
  testRegex: '.*\.e2e-spec\.ts$',
  setupFiles: ['<rootDir>/test/tiktok/setup-env.ts'],
  collectCoverageFrom: TIKTOK_COVERAGE_SCOPE,
  coverageDirectory: '<rootDir>/coverage-tiktok/e2e',
  // The legacy thresholds name modules outside this scope.
  coverageThreshold: {},
};
