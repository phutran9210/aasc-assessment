import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LeadSyncConfig } from '@config/index.js';

import { hashMapping } from '../domain/sync-hash.js';
import { LeadSyncConfigError, LeadSyncMappingError } from '../errors/index.js';
import { MappingLoader } from '../services/mapping-loader.service.js';

const config = (mappingPath: string): LeadSyncConfig => ({
  mappingPath,
  cron: undefined,
  timezone: 'Asia/Ho_Chi_Minh',
  direction: 'sheet-to-bitrix',
  defaultCountry: 'VN',
  maxRetries: 0,
  logRetentionDays: 30,
  batchSize: 25,
  retryBaseDelayMs: 0,
  lockStaleMs: 120_000,
});

describe('MappingLoader', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mapping-'));
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  const write = (content: string): string => {
    const path = join(directory, 'mapping.json');
    writeFileSync(path, content);
    return path;
  };

  it('should load the default mapping relative to the working directory', async () => {
    const { mapping, hash } = await new MappingLoader(config('config/mapping.json')).load();

    expect(mapping.fields).toHaveLength(9);
    expect(hash).toBe(hashMapping(mapping));
  });

  it('should read the file again on every load, so an edit applies to the next run', async () => {
    const path = write(
      JSON.stringify({
        version: 1,
        dedupe: { keys: ['email'] },
        fields: [{ column: 'Email', field: 'email', type: 'email' }],
      }),
    );
    const loader = new MappingLoader(config(path));
    const first = await loader.load();

    write(
      JSON.stringify({
        version: 1,
        dedupe: { keys: ['email'] },
        fields: [{ column: 'Thư', field: 'email', type: 'email' }],
      }),
    );
    const second = await loader.load();

    expect(second.mapping.fields[0].column).toBe('Thư');
    expect(second.hash).not.toBe(first.hash);
  });

  it('should name the path when the file is missing or is not JSON', async () => {
    const missing = join(directory, 'none.json');
    await expect(new MappingLoader(config(missing)).load()).rejects.toThrow(
      new LeadSyncConfigError(`Không đọc được file mapping ${missing}`),
    );

    const broken = write('{ not json');
    await expect(new MappingLoader(config(broken)).load()).rejects.toThrow(
      new LeadSyncConfigError(`File mapping ${broken} không phải JSON hợp lệ`),
    );
  });

  it('should fail with a mapping error when the structure is wrong', async () => {
    const path = write(JSON.stringify({ version: 1, fields: [] }));

    await expect(new MappingLoader(config(path)).load()).rejects.toBeInstanceOf(
      LeadSyncMappingError,
    );
  });

  describe('save', () => {
    const VALID = {
      version: 1,
      fields: [
        { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
        { column: 'Email', field: 'email', type: 'email' },
      ],
      dedupe: { keys: ['email'], requireAtLeastOne: true },
    };

    it('should write a valid mapping so that the next run loads it', async () => {
      const path = write('{"version":1,"fields":[]}');
      const loader = new MappingLoader(config(path));

      const saved = await loader.save(VALID);

      const loaded = await loader.load();
      expect(loaded.mapping.fields.map((field) => field.column)).toEqual([
        'Tên khách hàng',
        'Email',
      ]);
      expect(saved.hash).toBe(loaded.hash);
      expect(readFileSync(path, 'utf8')).toMatch(/\n$/);
      expect(readdirSync(directory)).toEqual(['mapping.json']);
    });

    it('should refuse an invalid mapping and leave the file as it was', async () => {
      const before = JSON.stringify(VALID);
      const path = write(before);

      await expect(
        new MappingLoader(config(path)).save({ version: 1, fields: [{ column: 'Email' }] }),
      ).rejects.toBeInstanceOf(LeadSyncMappingError);
      expect(readFileSync(path, 'utf8')).toBe(before);
    });

    it('should say that the file cannot be written when its folder is read-only or missing', async () => {
      const path = join(directory, 'missing-folder', 'mapping.json');

      await expect(new MappingLoader(config(path)).save(VALID)).rejects.toThrow(
        `Không ghi được file mapping ${path}`,
      );
    });
  });
});
