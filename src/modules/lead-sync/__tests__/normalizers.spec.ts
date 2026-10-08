import {
  normalizeEmail,
  normalizeLookup,
  normalizeDate,
  normalizeNumber,
  normalizePhone,
  normalizeText,
} from '../domain/normalizers/index.js';
import type { CellValue, MappingField } from '../types/index.js';

const cell = (formatted: string, raw: CellValue['raw'] = formatted): CellValue => ({
  formatted,
  raw,
});

describe('normalizeText', () => {
  it.each([
    ['  Nguyễn   Văn  An ', 'Nguyễn Văn An'],
    ['dòng 1\ndòng 2', 'dòng 1 dòng 2'],
    ['   ', undefined],
    ['', undefined],
  ])('should turn %j into %j', (input, expected) => {
    expect(normalizeText(cell(input))).toEqual({ ok: true, value: expected });
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['An.Nguyen@Example.com ', 'an.nguyen@example.com'],
    ['', undefined],
  ])('should turn %j into %j', (input, expected) => {
    expect(normalizeEmail(cell(input))).toEqual({ ok: true, value: expected });
  });

  it.each(['an@', 'an example.com', 'an@example', '@example.com', 'a@b@c.vn'])(
    'should reject %j',
    (input) => {
      expect(normalizeEmail(cell(input)).ok).toBe(false);
    },
  );
});

describe('normalizePhone', () => {
  it.each([
    ['0901 234 567', '+84901234567'],
    ['901234567', '+84901234567'],
    ['+84 901234567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['0084 901 234 567', '+84901234567'],
    ['(090) 123-45.67', '+84901234567'],
    ['+1 202 555 0123', '+12025550123'],
    ['', undefined],
  ])('should turn %j into %j for VN', (input, expected) => {
    expect(normalizePhone(cell(input), 'VN')).toEqual({ ok: true, value: expected });
  });

  it('should read the displayed text, not the number Sheets stored without the leading zero', () => {
    expect(normalizePhone(cell('0901234567', 901234567), 'VN')).toEqual({
      ok: true,
      value: '+84901234567',
    });
  });

  it('should use the calling code of the default country', () => {
    expect(normalizePhone(cell('2025550123'), 'US')).toEqual({ ok: true, value: '+12025550123' });
    expect(normalizePhone(cell('81234567'), 'SG')).toEqual({ ok: true, value: '+6581234567' });
  });

  it.each(['abc', '09012x4567', '123', '+1234567890123456', '#N/A'])(
    'should reject %j',
    (input) => {
      expect(normalizePhone(cell(input), 'VN').ok).toBe(false);
    },
  );
});

describe('normalizeNumber', () => {
  it.each<[string, CellValue['raw'], number | undefined]>([
    ['1.500.000 ₫', 1500000, 1500000],
    ['1500000', '1500000', 1500000],
    ['1.500.000 ₫', '1.500.000 ₫', 1500000],
    ['1,500,000', '1,500,000', 1500000],
    ['15tr', '15tr', 15000000],
    ['1,5 triệu', '1,5 triệu', 1500000],
    ['500k', '500k', 500000],
    ['2 tỷ', '2 tỷ', 2000000000],
    ['12.5', '12.5', 12.5],
    ['1.500', '1.500', 1500],
    ['0', 0, 0],
    ['', null, undefined],
  ])('should turn %j (raw %j) into %j', (formatted, raw, expected) => {
    expect(normalizeNumber(cell(formatted, raw))).toEqual({ ok: true, value: expected });
  });

  it.each<[string, CellValue['raw']]>([
    ['nhiều', 'nhiều'],
    ['-5', -5],
    ['-5', '-5'],
    ['1.2.3', '1.2.3'],
    ['TRUE', true],
  ])('should reject %j', (formatted, raw) => {
    expect(normalizeNumber(cell(formatted, raw)).ok).toBe(false);
  });
});

describe('normalizeLookup', () => {
  const stage: MappingField = {
    column: 'Trạng thái',
    field: 'stageId',
    type: 'enum',
    required: false,
    values: { Mới: 'NEW', 'Đang liên hệ': 'IN_PROCESS' },
    onUnknown: 'error',
  };

  it('should map a label to its code, ignoring case and outer spaces', () => {
    expect(normalizeLookup(cell(' đang LIÊN hệ '), stage)).toEqual({
      ok: true,
      value: 'IN_PROCESS',
    });
  });

  it('should report the allowed labels for an unknown one', () => {
    expect(normalizeLookup(cell('Đã chốt'), stage)).toEqual({
      ok: false,
      error: 'giá trị "Đã chốt" không hợp lệ; chọn một trong: Mới, Đang liên hệ',
    });
  });

  it('should fall back to the default when onUnknown is "default"', () => {
    expect(
      normalizeLookup(cell('Đã chốt'), { ...stage, onUnknown: 'default', default: 'NEW' }),
    ).toEqual({ ok: true, value: 'NEW' });
  });

  it('should never fail for the "user" type: an unknown person keeps the mapping default', () => {
    const owner: MappingField = {
      column: 'Người phụ trách',
      field: 'assignedById',
      type: 'user',
      required: false,
      values: { 'an@congty.vn': 7 },
      onUnknown: 'error',
    };

    expect(normalizeLookup(cell('AN@congty.vn'), owner)).toEqual({ ok: true, value: 7 });
    expect(normalizeLookup(cell('Người lạ'), owner)).toEqual({ ok: true, value: undefined });
    expect(normalizeLookup(cell(''), owner)).toEqual({ ok: true, value: undefined });
  });
});

describe('normalizeDate', () => {
  it.each<[string, CellValue['raw'], string | undefined]>([
    ['08/10/2026', 46303, '2026-10-08'],
    ['Oct 8, 2026', 46303, '2026-10-08'],
    ['08/10/2026', '08/10/2026', '2026-10-08'],
    ['8/3/2026', '8/3/2026', '2026-03-08'],
    ['08-10-2026', '08-10-2026', '2026-10-08'],
    ['08.10.2026', '08.10.2026', '2026-10-08'],
    ['2026-10-08', '2026-10-08', '2026-10-08'],
    ['2026-10-08T09:30:00+07:00', '2026-10-08T09:30:00+07:00', '2026-10-08'],
    ['08/10/2026 14:30', 46303.604166, '2026-10-08'],
    ['', null, undefined],
  ])('should turn %j (raw %j) into %j', (formatted, raw, expected) => {
    expect(normalizeDate(cell(formatted, raw))).toEqual({ ok: true, value: expected });
  });

  it.each<[string, CellValue['raw']]>([
    ['31/02/2026', '31/02/2026'],
    ['2026-13-01', '2026-13-01'],
    ['hôm qua', 'hôm qua'],
    ['-5', -5],
    ['TRUE', true],
  ])('should reject %j', (formatted, raw) => {
    expect(normalizeDate(cell(formatted, raw))).toEqual({
      ok: false,
      error: 'ngày không hợp lệ, ví dụ đúng: 08/10/2026 hoặc 2026-10-08',
    });
  });
});
