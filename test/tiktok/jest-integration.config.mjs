import baseConfig from '../../jest.config.mjs';
import { TIKTOK_COVERAGE_SCOPE } from './coverage-scope.mjs';

export default {
  ...baseConfig,
  rootDir: '../..',
  roots: ['<rootDir>/test/tiktok'],
  testRegex: '.*\.integration-spec\.ts$',
  setupFiles: ['<rootDir>/test/tiktok/setup-env.ts'],
  collectCoverageFrom: TIKTOK_COVERAGE_SCOPE,
  coverageDirectory: '<rootDir>/coverage-tiktok/integration',
  // The legacy thresholds name modules outside this scope.
  coverageThreshold: {},
};
