import { readFileSync } from 'node:fs';

import { parseMapping } from '../domain/mapping-schema.js';
import { transformRow } from '../domain/row-transformer.js';
import { hashMapping } from '../domain/sync-hash.js';
import { buildLeadRows, isSeededEmail } from '../seeders/lead-row.seeder.js';
import type { SheetRow, ValidRow } from '../types/index.js';

const mapping = parseMapping(JSON.parse(readFileSync('config/mapping.json', 'utf8')));
const context = { mapping, mappingHash: hashMapping(mapping), defaultCountry: 'VN' as const };

const toSheetRow = (cells: Record<string, string>, rowNumber: number): SheetRow => ({
  rowNumber,
  cells: Object.fromEntries(
    Object.entries(cells).map(([column, value]) => [column, { formatted: value, raw: value }]),
  ),
  state: { leadId: '', status: '', error: '', hash: '' },
});

describe('buildLeadRows', () => {
  it('should produce rows that all pass validation with the default mapping', () => {
    const rows = buildLeadRows(mapping, { count: 300, seed: 7 });

    const transformed = rows.map((cells, index) =>
      transformRow(toSheetRow(cells, index + 2), context),
    );

    expect(rows).toHaveLength(300);
    expect(transformed.filter((row) => row.kind !== 'valid')).toEqual([]);
  });

  it('should never repeat an email or a phone, also across two seeds that follow each other', () => {
    const rows = [
      ...buildLeadRows(mapping, { count: 200, seed: 1 }),
      ...buildLeadRows(mapping, { count: 200, seed: 1, startIndex: 201 }),
    ];
    const valid = rows.map(
      (cells, index) => transformRow(toSheetRow(cells, index + 2), context) as ValidRow,
    );

    expect(new Set(valid.map((row) => row.email)).size).toBe(400);
    expect(new Set(valid.map((row) => row.phone)).size).toBe(400);
  });

  it('should mark every row with the seed email domain and fill exactly the mapped columns', () => {
    const [row] = buildLeadRows(mapping, { count: 1, seed: 3 });

    expect(Object.keys(row)).toEqual(mapping.fields.map((field) => field.column));
    expect(isSeededEmail(row.Email)).toBe(true);
    expect(isSeededEmail('an@congty.vn')).toBe(false);
    expect(Object.keys(mapping.fields.find((f) => f.field === 'stageId')?.values ?? {})).toContain(
      row['Trạng thái'],
    );
  });

  it('should produce the same rows for the same seed', () => {
    expect(buildLeadRows(mapping, { count: 5, seed: 42 })).toEqual(
      buildLeadRows(mapping, { count: 5, seed: 42 }),
    );
  });
});
