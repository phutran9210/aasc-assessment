import { buildCreateFields, buildUpdateFields } from '../gateways/lead-payload.js';
import type { ValidRow } from '../types/index.js';

const row = (overrides: Partial<ValidRow> = {}): ValidRow => ({
  kind: 'valid',
  rowNumber: 2,
  fields: { name: 'An', title: 'An - ACME', opportunity: 1500000, UF_CRM_1700000000: 'Zalo' },
  email: 'an@example.com',
  phone: '+84901234567',
  hash: 'h',
  ...overrides,
});

describe('buildCreateFields', () => {
  it('should send the lead fields, both contact values and the originator mark', () => {
    expect(buildCreateFields(row())).toEqual({
      name: 'An',
      title: 'An - ACME',
      opportunity: 1500000,
      UF_CRM_1700000000: 'Zalo',
      fm: [
        { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
        { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
      ],
      originatorId: 'google-sheets',
    });
  });

  it('should send only the contact value the row has', () => {
    expect(buildCreateFields(row({ email: undefined })).fm).toEqual([
      { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
    ]);
    expect(buildCreateFields(row({ phone: undefined })).fm).toEqual([
      { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
    ]);
  });
});

describe('buildUpdateFields', () => {
  const current = {
    id: 345,
    fm: [
      { id: 11, typeId: 'PHONE', valueType: 'MOBILE', value: '0901 111 222' },
      { id: 12, typeId: 'EMAIL', valueType: 'WORK', value: 'old@example.com' },
      { id: 13, typeId: 'EMAIL', valueType: 'HOME', value: 'second@example.com' },
    ],
  };

  it('should replace the first value of each type through its multifield id', () => {
    expect(buildUpdateFields(row(), current)).toEqual({
      name: 'An',
      title: 'An - ACME',
      opportunity: 1500000,
      UF_CRM_1700000000: 'Zalo',
      fm: {
        11: { typeId: 'PHONE', valueType: 'MOBILE', value: '+84901234567' },
        12: { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
      },
    });
  });

  it('should leave a value alone when the lead already has it in any format', () => {
    const fields = buildUpdateFields(
      row({ phone: '+84901111222', email: 'SECOND@example.com'.toLowerCase() }),
      current,
    );

    expect(fields).not.toHaveProperty('fm');
  });

  it('should add a value with an n-key when the lead has none of that type', () => {
    expect(buildUpdateFields(row(), { id: 345 }).fm).toEqual({
      n0: { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
      n1: { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
    });
    expect(buildUpdateFields(row(), undefined).fm).toEqual({
      n0: { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
      n1: { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
    });
  });

  it('should never send the originator mark or an fm array on update', () => {
    const fields = buildUpdateFields(row(), current);

    expect(fields).not.toHaveProperty('originatorId');
    expect(Array.isArray(fields.fm)).toBe(false);
  });
});

describe('several emails or phones in one cell', () => {
  const many = row({
    extraEmails: ['an.2@example.com'],
    extraPhones: ['+84912345678', '+84987654321'],
  });

  it('should create the lead with every value, the first one of each type leading', () => {
    expect(buildCreateFields(many).fm).toEqual([
      { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
      { typeId: 'PHONE', valueType: 'WORK', value: '+84912345678' },
      { typeId: 'PHONE', valueType: 'WORK', value: '+84987654321' },
      { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
      { typeId: 'EMAIL', valueType: 'WORK', value: 'an.2@example.com' },
    ]);
  });

  it('should add only the extra values the lead does not have yet, replacing nothing', () => {
    const current = {
      id: 345,
      fm: [
        { id: 11, typeId: 'PHONE', valueType: 'MOBILE', value: '0901 234 567' },
        { id: 12, typeId: 'PHONE', valueType: 'WORK', value: '+84912345678' },
        { id: 13, typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
      ],
    };

    expect(buildUpdateFields(many, current).fm).toEqual({
      n0: { typeId: 'PHONE', valueType: 'WORK', value: '+84987654321' },
      n1: { typeId: 'EMAIL', valueType: 'WORK', value: 'an.2@example.com' },
    });
  });
});
