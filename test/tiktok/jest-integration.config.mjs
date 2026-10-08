import baseConfig from '../../jest.config.mjs';

export default {
  ...baseConfig,
  rootDir: '../..',
  roots: ['<rootDir>/test/tiktok'],
  testRegex: '.*\.integration-spec\.ts$',
  setupFiles: ['<rootDir>/test/tiktok/setup-env.ts'],
  coverageDirectory: '<rootDir>/coverage-tiktok/integration',
};
