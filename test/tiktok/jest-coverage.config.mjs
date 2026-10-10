import { fileURLToPath } from 'node:url';

import { TIKTOK_COVERAGE_SCOPE } from './coverage-scope.mjs';
import e2e from './jest-e2e.config.mjs';
import integration from './jest-integration.config.mjs';
import unit from './jest-unit.config.mjs';

// Projects resolve a relative rootDir against the wrong directory, so it is made absolute.
const rootDir = fileURLToPath(new URL('../..', import.meta.url));

/** Per-project settings only: coverage options belong to the combined run below. */
function project(displayName, config) {
  const { collectCoverageFrom, coverageDirectory, coverageThreshold, ...rest } = config;
  void collectCoverageFrom;
  void coverageDirectory;
  void coverageThreshold;
  return { ...rest, rootDir, displayName };
}

/**
 * One coverage report for the TikTok integration across its unit, integration and E2E suites.
 * Most of this code talks to PostgreSQL and Redis and is proven by the integration suites, so a
 * unit-only percentage would say little; the thresholds therefore apply to the combined run.
 *
 * All four metrics are held at 85 % across the combined suite.
 *
 * @type {import('jest').Config}
 */
export default {
  rootDir,
  projects: [project('unit', unit), project('integration', integration), project('e2e', e2e)],
  collectCoverageFrom: TIKTOK_COVERAGE_SCOPE,
  coverageDirectory: '<rootDir>/coverage-tiktok/combined',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: { global: { statements: 85, functions: 85, lines: 85, branches: 85 } },
};
