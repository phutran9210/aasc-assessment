import { readFileSync } from 'node:fs';

import type { SheetCell, SheetsClient } from '@modules/google-sheets/index.js';

import { parseMapping } from '../domain/mapping-schema.js';
import { hashMapping } from '../domain/sync-hash.js';
import type { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LeadSheetSeeder } from '../services/lead-sheet-seeder.service.js';
import type { MappingLoader } from '../services/mapping-loader.service.js';
import { SheetTable } from '../services/sheet-table.service.js';
import { FakeLeadGateway } from './support/fake-lead-gateway.js';
import { FakeSheetsClient } from './support/fake-sheets-client.js';

const mapping = parseMapping(JSON.parse(readFileSync('config/mapping.json', 'utf8')));
const HEADERS = [
  ...mapping.fields.map((field) => field.column),
  'Trạng thái đồng bộ',
  'Lead ID Bitrix24',
  'Thời gian đồng bộ cuối',
  'Thông báo lỗi',
  'Sync Hash',
];
const real = (name: string, email: string): SheetCell[] => [
  name,
  email,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
];

describe('LeadSheetSeeder', () => {
  const build = (rows: SheetCell[][]) => {
    const sheet = new FakeSheetsClient(HEADERS, rows);
    const gateway = new FakeLeadGateway();
    const loader = { load: () => Promise.resolve({ mapping, hash: hashMapping(mapping) }) };
    const client = sheet as unknown as SheetsClient;
    const seeder = new LeadSheetSeeder(
      client,
      new SheetTable(client),
      loader as unknown as MappingLoader,
      gateway as unknown as BitrixLeadGateway,
    );
    return { sheet, gateway, seeder };
  };

  it('should append the rows under the last one and leave existing rows as they were', async () => {
    const { sheet, seeder } = build([real('An', 'an@congty.vn'), real('Bình', 'binh@congty.vn')]);

    const outcome = await seeder.seed(40, 7);

    expect(outcome).toEqual({ added: 40, firstRow: 4, lastRow: 43 });
    expect(sheet.cell(2, 'Email')).toBe('an@congty.vn');
    expect(sheet.cell(3, 'Email')).toBe('binh@congty.vn');
    expect(sheet.cell(4, 'Email')).toMatch(/\.1@seed\.example\.com$/);
    expect(sheet.cell(43, 'Email')).toMatch(/\.40@seed\.example\.com$/);
    expect(sheet.cell(44, 'Email')).toBe('');
    expect(sheet.cell(4, 'Lead ID Bitrix24')).toBe('');
  });

  it('should continue the numbering on a second seed, so emails stay unique', async () => {
    const { sheet, seeder } = build([]);
    await seeder.seed(3, 1);

    await seeder.seed(2, 1);

    const emails = [2, 3, 4, 5, 6].map((rowNumber) => sheet.cell(rowNumber, 'Email'));
    expect(new Set(emails).size).toBe(5);
    expect(emails[3]).toMatch(/\.4@seed\.example\.com$/);
  });

  it('should add rows to the grid when the worksheet is too short', async () => {
    const { sheet, seeder } = build([]);

    await seeder.seed(1200, 1);

    expect(sheet.structureRequests).toContainEqual({
      appendDimension: { sheetId: 77, dimension: 'ROWS', length: 201 },
    });
  });

  it('should refuse to seed a worksheet that lacks a mapped column', async () => {
    const sheet = new FakeSheetsClient(['Tên khách hàng', 'Email'], []);
    const client = sheet as unknown as SheetsClient;
    const seeder = new LeadSheetSeeder(
      client,
      new SheetTable(client),
      { load: () => Promise.resolve({ mapping, hash: 'h' }) } as unknown as MappingLoader,
      new FakeLeadGateway() as unknown as BitrixLeadGateway,
    );

    await expect(seeder.seed(5)).rejects.toThrow('Sheet không có cột "Số điện thoại"');
    expect(sheet.calls.write).toBe(0);
  });

  it('should delete only seeded rows, bottom run first, and the leads they are linked to', async () => {
    const { sheet, gateway, seeder } = build([real('An', 'an@congty.vn')]);
    await seeder.seed(3, 1);
    sheet.setCell(6, 'Tên khách hàng', 'Thật');
    sheet.setCell(6, 'Email', 'that@congty.vn');
    await seeder.seed(2, 1);
    const kept = gateway.seed({ email: 'an@congty.vn' });
    const gone = gateway.seed({ email: 'x@seed.example.com' });
    sheet.setCell(2, 'Lead ID Bitrix24', String(kept));
    sheet.setCell(4, 'Lead ID Bitrix24', String(gone));
    sheet.structureRequests = [];

    const outcome = await seeder.clear();

    expect(outcome).toEqual({ rows: 5, leads: 1 });
    expect(sheet.structureRequests).toEqual([
      {
        deleteDimension: { range: { sheetId: 77, dimension: 'ROWS', startIndex: 6, endIndex: 8 } },
      },
      {
        deleteDimension: { range: { sheetId: 77, dimension: 'ROWS', startIndex: 2, endIndex: 5 } },
      },
    ]);
    expect([...gateway.leads.keys()]).toEqual([kept]);
  });

  it('should do nothing when the worksheet has no seeded row', async () => {
    const { sheet, seeder } = build([real('An', 'an@congty.vn')]);

    await expect(seeder.clear()).resolves.toEqual({ rows: 0, leads: 0 });
    expect(sheet.calls.write).toBe(0);
  });
});
