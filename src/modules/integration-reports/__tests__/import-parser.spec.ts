import { BadRequestException } from '@nestjs/common';

import {
  COST_IMPORT_SCHEMA,
  LEAD_IMPORT_SCHEMA,
  parseCsv,
  readImportRecords,
} from '../domain/import-parser.js';

const csv = (text: string) => Buffer.from(text, 'utf8');
const LEAD_HEADER = 'advertiser_id,source_record_id,occurred_at,full_name,email,phone';

describe('CSV parsing', () => {
  it('strips a UTF-8 BOM and accepts CRLF, LF and a missing final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\n3,4')).toEqual({
      header: ['a', 'b'],
      rows: [
        { rowNumber: 1, cells: ['1', '2'] },
        { rowNumber: 2, cells: ['3', '4'] },
      ],
    });
  });

  it('keeps quoted delimiters, escaped quotes and newlines inside one field', () => {
    const { rows } = parseCsv('a,b\n"x,1","say ""hi""\nsecond line"\n');

    expect(rows).toEqual([{ rowNumber: 1, cells: ['x,1', 'say "hi"\nsecond line'] }]);
  });

  it('skips blank lines without shifting row numbers of real rows', () => {
    const { rows } = parseCsv('a\n1\n\n2\n\n');

    expect(rows.map((row) => [row.rowNumber, row.cells])).toEqual([
      [1, ['1']],
      [2, ['2']],
    ]);
  });

  it('reports an unterminated quote in the final row instead of dropping the file', () => {
    const { rows } = parseCsv('a,b\n1,2\n3,"never closed');

    expect(rows).toEqual([
      { rowNumber: 1, cells: ['1', '2'] },
      { rowNumber: 2, cells: null, errorCode: 'ROW_MALFORMED' },
    ]);
  });

  it('flags rows whose column count differs from the header', () => {
    const { rows } = parseCsv('a,b\n1\n1,2,3\n1,2\n');

    expect(rows.map((row) => row.errorCode)).toEqual([
      'ROW_COLUMN_COUNT_MISMATCH',
      'ROW_COLUMN_COUNT_MISMATCH',
      undefined,
    ]);
  });
});

describe('import records', () => {
  it('maps CSV cells to the explicit lead schema', () => {
    const result = readImportRecords(
      'csv',
      csv(`${LEAD_HEADER}\nadv-1,src-1,2026-01-01T00:00:00Z,"Nguyễn, A",a@example.test,\n`),
      LEAD_IMPORT_SCHEMA,
    );

    expect(result.records).toEqual([
      {
        rowNumber: 1,
        values: {
          advertiser_id: 'adv-1',
          source_record_id: 'src-1',
          occurred_at: '2026-01-01T00:00:00Z',
          full_name: 'Nguyễn, A',
          email: 'a@example.test',
          phone: '',
        },
      },
    ]);
  });

  it.each([
    ['a duplicated header', 'advertiser_id,source_record_id,occurred_at,full_name,email,email\n'],
    ['an unknown header', `${LEAD_HEADER},password\n`],
    ['a missing required header', 'advertiser_id,occurred_at,full_name,email\n'],
    ['an empty file', ''],
    ['a header that differs only by case', `${LEAD_HEADER},Email\n`],
  ])('rejects %s', (_name, text) => {
    expect(() => readImportRecords('csv', csv(text), LEAD_IMPORT_SCHEMA)).toThrow(
      BadRequestException,
    );
  });

  it('reads a JSON root array and flags elements that are not objects', () => {
    const result = readImportRecords(
      'json',
      csv(
        JSON.stringify([
          { advertiser_id: 'adv-1', source_record_id: 7, full_name: 'A', extra: { nested: true } },
          'not an object',
          null,
        ]),
      ),
      LEAD_IMPORT_SCHEMA,
    );

    expect(result.records).toEqual([
      {
        rowNumber: 1,
        values: { advertiser_id: 'adv-1', source_record_id: '7', full_name: 'A' },
      },
      { rowNumber: 2, values: null, errorCode: 'ROW_MALFORMED' },
      { rowNumber: 3, values: null, errorCode: 'ROW_MALFORMED' },
    ]);
  });

  it.each([['{"rows":[]}'], ['[1,2'], ['']])('rejects the JSON document %s', (text) => {
    expect(() => readImportRecords('json', csv(text), LEAD_IMPORT_SCHEMA)).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid UTF-8 instead of importing replacement characters', () => {
    expect(() =>
      readImportRecords(
        'csv',
        Buffer.concat([csv(`${LEAD_HEADER}\nadv-1,src-1,x,`), Buffer.from([0xff, 0xfe])]),
        LEAD_IMPORT_SCHEMA,
      ),
    ).toThrow(BadRequestException);
  });

  it('declares the campaign cost schema with its required columns', () => {
    expect(COST_IMPORT_SCHEMA.required).toEqual([
      'advertiser_id',
      'campaign_id',
      'date',
      'currency',
      'spend',
    ]);
    expect(() =>
      readImportRecords('csv', csv('advertiser_id,campaign_id,date,spend\n'), COST_IMPORT_SCHEMA),
    ).toThrow(BadRequestException);
  });
});
