import baseConfig from '../jest.config.mjs';

/**
 * E2E test config: same transform/aliases as unit tests, but boots the real AppModule.
 *
 * @type {import('jest').Config}
 */
export default {
  ...baseConfig,
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
