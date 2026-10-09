import baseConfig from '../../jest.config.mjs';
import { TIKTOK_COVERAGE_SCOPE } from './coverage-scope.mjs';

export default {
  ...baseConfig,
  rootDir: '../..',
  roots: ['<rootDir>/src'],
  testRegex: '.*\.spec\.ts$',
  setupFiles: ['<rootDir>/test/tiktok/setup-env.ts'],
  collectCoverageFrom: TIKTOK_COVERAGE_SCOPE,
  coverageDirectory: '<rootDir>/coverage-tiktok/unit',
  // The legacy thresholds name modules outside this scope.
  coverageThreshold: {},
};
