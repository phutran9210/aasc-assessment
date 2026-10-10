/**
 * Unit test config.
 * Source is ESM (`.js` suffix on every relative/alias import); ts-jest compiles it to
 * CommonJS for Jest, so `moduleNameMapper` strips the suffix and resolves path aliases.
 * ESM-only packages (NestJS 12, uuid) are loaded through `--experimental-vm-modules`.
 *
 * @type {import('jest').Config}
 */
export default {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts', '<rootDir>/test/tiktok/setup-env.ts'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleNameMapper: {
    '^@(common|config|core|modules)/(.*)\\.js$': '<rootDir>/src/$1/$2',
    '^@/(.*)\\.js$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/index.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { statements: 85, branches: 85, functions: 85, lines: 85 },
  },
};
