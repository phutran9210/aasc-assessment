import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDatabaseOptions } from '../database.options.js';
import { ENTITIES } from '../entities/index.js';

describe('buildDatabaseOptions', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'aasc-db-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('should create the parent folder and enable WAL when the database is a file', () => {
    const path = join(workDir, 'nested', 'deep', 'app.sqlite');

    const options = buildDatabaseOptions({ path, synchronize: true, logging: false });

    expect(existsSync(join(workDir, 'nested', 'deep'))).toBe(true);
    expect(options).toEqual({
      type: 'better-sqlite3',
      database: path,
      entities: ENTITIES,
      synchronize: true,
      logging: false,
      enableWAL: true,
    });
  });

  it('should not touch the filesystem or enable WAL when the database is in memory', () => {
    const options = buildDatabaseOptions({ path: ':memory:', synchronize: false, logging: true });

    expect(options).toEqual(
      expect.objectContaining({ database: ':memory:', enableWAL: false, synchronize: false }),
    );
    expect(existsSync(':memory:')).toBe(false);
  });
});
