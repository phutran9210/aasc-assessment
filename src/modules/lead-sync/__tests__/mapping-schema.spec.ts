import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkMapping, parseMapping } from '../domain/mapping-schema.js';
import { LeadSyncMappingError } from '../errors/index.js';

const minimal = () => ({
  version: 1,
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
    { column: 'Email', field: 'email', type: 'email' },
    { column: 'Số điện thoại', field: 'phone', type: 'phone' },
  ],
});

const problemsOf = (raw: unknown): string[] => {
  try {
    parseMapping(raw);
  } catch (error) {
    if (error instanceof LeadSyncMappingError) return error.problems;
    throw error;
  }
  return [];
};

describe('parseMapping', () => {
  it('should fill the defaults of an abbreviated mapping', () => {
    expect(parseMapping(minimal())).toEqual({
      version: 1,
      sheet: { headerRow: 1 },
      defaults: {},
      dedupe: { keys: ['email', 'phone'], requireAtLeastOne: true },
      fields: [
        {
          column: 'Tên khách hàng',
          field: 'name',
          type: 'string',
          required: true,
          onUnknown: 'error',
        },
        { column: 'Email', field: 'email', type: 'email', required: false, onUnknown: 'error' },
        {
          column: 'Số điện thoại',
          field: 'phone',
          type: 'phone',
          required: false,
          onUnknown: 'error',
        },
      ],
    });
  });

  it('should accept the mapping shipped in config/mapping.json', () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'mapping.json'), 'utf8'),
    );
    const mapping = parseMapping(raw);

    expect(mapping.fields.map((field) => field.column)).toEqual([
      'Tên khách hàng',
      'Email',
      'Số điện thoại',
      'Công ty',
      'Nguồn lead (UTM Source)',
      'Ngân sách dự kiến',
      'Trạng thái',
      'Người phụ trách',
      'Ghi chú',
    ]);
    expect(mapping.titleTemplate).toBe('{Tên khách hàng} - {Công ty}');
  });

  it('should accept a custom UF_CRM field declared like any other field', () => {
    const raw = minimal();
    raw.fields.push({ column: 'Kênh ưa thích', field: 'UF_CRM_1700000000', type: 'string' });

    expect(parseMapping(raw).fields).toHaveLength(4);
  });

  it('should reject a duplicated column and a duplicated field', () => {
    const raw = minimal();
    raw.fields.push({ column: 'Email', field: 'comments', type: 'string' });
    raw.fields.push({ column: 'Ghi chú', field: 'name', type: 'string' });

    expect(problemsOf(raw)).toEqual([
      'cột "Email" được khai báo hai lần',
      'trường "name" được khai báo hai lần',
    ]);
  });

  it('should reject an unknown type, an enum without values and a technical column', () => {
    expect(
      problemsOf({ ...minimal(), fields: [{ column: 'A', field: 'a', type: 'date' }] }),
    ).not.toHaveLength(0);

    const raw = minimal();
    raw.fields.push({ column: 'Trạng thái', field: 'stageId', type: 'enum' });
    raw.fields.push({ column: 'Sync Hash', field: 'comments', type: 'string' });
    expect(problemsOf(raw)).toEqual([
      'cột "Trạng thái" kiểu enum phải có bảng values',
      'cột "Sync Hash" do ứng dụng quản lý, không được đưa vào mapping',
    ]);
  });

  it('should reject a dedupe key that no column feeds', () => {
    const raw = { ...minimal(), fields: minimal().fields.slice(0, 2) };

    expect(problemsOf(raw)).toEqual([
      'dedupe.keys có "phone" nhưng không cột nào ánh xạ vào trường "phone"',
    ]);
  });

  it.each([null, 'text', [], { version: 2, fields: [] }, { version: 1, fields: [] }])(
    'should reject %j with a mapping error',
    (raw) => {
      expect(() => parseMapping(raw)).toThrow(LeadSyncMappingError);
    },
  );

  it('should reject unknown keys so a typo does not go unnoticed', () => {
    expect(problemsOf({ ...minimal(), titleTemplte: '{Email}' })).not.toHaveLength(0);
  });
});

describe('checkMapping', () => {
  const mapping = parseMapping({
    ...minimal(),
    titleTemplate: '{Tên khách hàng} - {Công ty}',
    defaults: { currencyId: 'VND' },
  });
  const leadFields = new Set(['name', 'title', 'currencyId']);

  it('should find no problem when every column and field exists', () => {
    expect(
      checkMapping(
        mapping,
        ['Số điện thoại', 'Công ty', 'Email', 'Tên khách hàng', 'Cột khác'],
        leadFields,
      ),
    ).toEqual([]);
  });

  it('should name every missing column, including those of the title template', () => {
    expect(checkMapping(mapping, ['Tên khách hàng', 'Email'], leadFields)).toEqual([
      'Sheet không có cột "Số điện thoại"',
      'Sheet không có cột "Công ty"',
    ]);
  });

  it('should name every lead field Bitrix24 does not know, in fields and in defaults', () => {
    expect(
      checkMapping(
        mapping,
        ['Tên khách hàng', 'Email', 'Số điện thoại', 'Công ty'],
        new Set(['title']),
      ),
    ).toEqual([
      'Bitrix24 không có trường lead "name"',
      'Bitrix24 không có trường lead "currencyId"',
    ]);
  });
});
