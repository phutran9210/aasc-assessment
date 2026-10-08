import { transformRow } from '../domain/row-transformer.js';
import type { TransformContext } from '../domain/row-transformer.js';
import { hashMapping } from '../domain/sync-hash.js';
import type { CellValue, LeadMapping, SheetRow } from '../types/index.js';

const mapping: LeadMapping = {
  version: 1,
  sheet: { headerRow: 1 },
  titleTemplate: '{Tên khách hàng} - {Công ty}',
  defaults: { currencyId: 'VND', stageId: 'NEW', assignedById: 1 },
  dedupe: { keys: ['email', 'phone'], requireAtLeastOne: true },
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true, onUnknown: 'error' },
    { column: 'Email', field: 'email', type: 'email', required: false, onUnknown: 'error' },
    { column: 'Số điện thoại', field: 'phone', type: 'phone', required: false, onUnknown: 'error' },
    {
      column: 'Công ty',
      field: 'companyTitle',
      type: 'string',
      required: false,
      onUnknown: 'error',
    },
    {
      column: 'Ngân sách dự kiến',
      field: 'opportunity',
      type: 'number',
      required: false,
      onUnknown: 'error',
    },
    {
      column: 'Trạng thái',
      field: 'stageId',
      type: 'enum',
      required: false,
      values: { Mới: 'NEW', 'Đang liên hệ': 'IN_PROCESS' },
      onUnknown: 'error',
    },
    {
      column: 'Người phụ trách',
      field: 'assignedById',
      type: 'user',
      required: false,
      values: { 'an@congty.vn': 7 },
      onUnknown: 'error',
    },
  ],
};

const context: TransformContext = {
  mapping,
  mappingHash: hashMapping(mapping),
  defaultCountry: 'VN',
};

const row = (
  cells: Record<string, string | [string, CellValue['raw']]>,
  rowNumber = 2,
): SheetRow => ({
  rowNumber,
  cells: Object.fromEntries(
    Object.entries(cells).map(([column, value]) => [
      column,
      Array.isArray(value)
        ? { formatted: value[0], raw: value[1] }
        : { formatted: value, raw: value },
    ]),
  ),
  state: { leadId: '', status: '', error: '', hash: '' },
});

describe('transformRow', () => {
  it('should normalise a full row into lead fields, dedupe keys and a hash', () => {
    const result = transformRow(
      row({
        'Tên khách hàng': '  Nguyễn Văn   An ',
        Email: 'An.Nguyen@Example.com',
        'Số điện thoại': ['0901 234 567', 901234567],
        'Công ty': 'ACME',
        'Ngân sách dự kiến': ['1.500.000 ₫', 1500000],
        'Trạng thái': 'Đang liên hệ',
        'Người phụ trách': 'an@congty.vn',
      }),
      context,
    );

    expect(result).toEqual({
      kind: 'valid',
      rowNumber: 2,
      fields: {
        currencyId: 'VND',
        stageId: 'IN_PROCESS',
        assignedById: 7,
        name: 'Nguyễn Văn An',
        companyTitle: 'ACME',
        opportunity: 1500000,
        title: 'Nguyễn Văn An - ACME',
      },
      email: 'an.nguyen@example.com',
      phone: '+84901234567',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('should keep the mapping defaults for blank cells and drop a dangling title separator', () => {
    const result = transformRow(row({ 'Tên khách hàng': 'An', Email: 'an@example.com' }), context);

    expect(result).toMatchObject({
      kind: 'valid',
      fields: { currencyId: 'VND', stageId: 'NEW', assignedById: 1, name: 'An', title: 'An' },
      email: 'an@example.com',
    });
    expect(result).not.toHaveProperty('phone', expect.anything());
  });

  it('should accept a row that has only a phone, or only an email', () => {
    const phoneOnly = transformRow(
      row({ 'Tên khách hàng': 'An', 'Số điện thoại': '0901234567' }),
      context,
    );
    const emailOnly = transformRow(
      row({ 'Tên khách hàng': 'An', Email: 'an@example.com' }),
      context,
    );

    expect(phoneOnly).toMatchObject({ kind: 'valid', phone: '+84901234567', email: undefined });
    expect(emailOnly).toMatchObject({ kind: 'valid', email: 'an@example.com', phone: undefined });
  });

  it('should give the same hash when only the formatting of a cell changes', () => {
    const typed = transformRow(
      row({ 'Tên khách hàng': 'An', 'Số điện thoại': '0901 234 567', 'Ngân sách dự kiến': '15tr' }),
      context,
    );
    const reformatted = transformRow(
      row({
        'Tên khách hàng': ' An ',
        'Số điện thoại': '+84901234567',
        'Ngân sách dự kiến': ['15.000.000 ₫', 15000000],
      }),
      context,
    );

    expect(typed.kind).toBe('valid');
    expect(typed).toHaveProperty('hash', (reformatted as { hash: string }).hash);
  });

  it('should send a date column as YYYY-MM-DD and report a date that does not exist', () => {
    const withDate: TransformContext = {
      ...context,
      mapping: {
        ...mapping,
        fields: [
          ...mapping.fields,
          {
            column: 'Ngày hẹn',
            field: 'UF_CRM_MEETING_DATE',
            type: 'date',
            required: false,
            onUnknown: 'error',
          },
        ],
      },
    };
    const base = { 'Tên khách hàng': 'An', Email: 'an@congty.vn' };

    const valid = transformRow(row({ ...base, 'Ngày hẹn': ['Oct 8, 2026', 46303] }), withDate);
    const invalid = transformRow(row({ ...base, 'Ngày hẹn': '31/02/2026' }), withDate);

    expect(valid).toMatchObject({ kind: 'valid', fields: { UF_CRM_MEETING_DATE: '2026-10-08' } });
    expect(invalid).toMatchObject({
      kind: 'invalid',
      errors: ['Cột "Ngày hẹn": ngày không hợp lệ, ví dụ đúng: 08/10/2026 hoặc 2026-10-08'],
    });
  });

  it('should report an empty row without validating it', () => {
    expect(transformRow(row({ 'Tên khách hàng': '  ', Email: '' }, 9), context)).toEqual({
      kind: 'empty',
      rowNumber: 9,
    });
  });

  it('should ignore cells of columns that are not in the mapping', () => {
    expect(transformRow(row({ 'Ghi chú nội bộ': 'abc' }), context)).toEqual({
      kind: 'empty',
      rowNumber: 2,
    });
  });

  it('should collect every problem of a row, naming the column', () => {
    const result = transformRow(
      row({ Email: 'sai', 'Số điện thoại': 'abc', 'Trạng thái': 'Đã chốt', 'Công ty': 'ACME' }),
      context,
    );

    expect(result).toEqual({
      kind: 'invalid',
      rowNumber: 2,
      errors: [
        'Cột "Tên khách hàng": không được để trống',
        'Cột "Email": email sai định dạng, ví dụ đúng: ten@congty.vn',
        'Cột "Số điện thoại": số điện thoại chỉ gồm chữ số, có thể bắt đầu bằng + hoặc 0, dài 8 đến 15 chữ số',
        'Cột "Trạng thái": giá trị "Đã chốt" không hợp lệ; chọn một trong: Mới, Đang liên hệ',
        'Cần ít nhất Email hoặc Số điện thoại để chống trùng',
      ],
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('should require at least one dedupe key', () => {
    expect(transformRow(row({ 'Tên khách hàng': 'An', 'Công ty': 'ACME' }), context)).toMatchObject(
      {
        kind: 'invalid',
        errors: ['Cần ít nhất Email hoặc Số điện thoại để chống trùng'],
      },
    );
  });

  it('should treat a broken formula as an invalid value of its column', () => {
    expect(
      transformRow(
        row({ 'Tên khách hàng': 'An', Email: 'an@example.com', 'Công ty': '#REF!' }),
        context,
      ),
    ).toMatchObject({ kind: 'invalid', errors: ['Cột "Công ty": công thức đang lỗi (#REF!)'] });
  });

  it('should keep the hash of an invalid row stable until the row is edited', () => {
    const broken = { 'Tên khách hàng': 'An', Email: 'sai' };
    const first = transformRow(row(broken), context);
    const again = transformRow(row(broken), context);
    const edited = transformRow(row({ ...broken, Email: 'sai2' }), context);

    expect(first.kind).toBe('invalid');
    expect(first).toHaveProperty('hash', (again as { hash: string }).hash);
    expect(first).not.toHaveProperty('hash', (edited as { hash: string }).hash);
  });
});
