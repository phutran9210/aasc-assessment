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
  // The assessment asks for at least 70% unit coverage of the Google Sheets integration.
  coverageThreshold: {
    './src/modules/lead-sync/': { statements: 70, functions: 70, lines: 70 },
    './src/modules/google-sheets/': { statements: 70, functions: 70, lines: 70 },
  },
};
