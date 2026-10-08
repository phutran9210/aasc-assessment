import { encodeBatchCommand } from '../utils/batch-command.encoder.js';

/** Decodes the way a query string is decoded on the server: %XX and `+` as a space. */
const decode = (command: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(command.slice(command.indexOf('?') + 1)));

describe('encodeBatchCommand', () => {
  it('should encode flat parameters as method?key=value', () => {
    expect(
      encodeBatchCommand('crm.duplicate.findbycomm', {
        entity_type: 'LEAD',
        type: 'EMAIL',
        values: ['an@example.com'],
      }),
    ).toBe('crm.duplicate.findbycomm?entity_type=LEAD&type=EMAIL&values[0]=an%40example.com');
  });

  it('should return the bare method when there is no parameter', () => {
    expect(encodeBatchCommand('crm.item.fields', {})).toBe('crm.item.fields');
  });

  it('should encode nested objects and arrays with bracket keys', () => {
    const command = encodeBatchCommand('crm.item.add', {
      entityTypeId: 1,
      fields: {
        title: 'An',
        opportunity: 1500000,
        fm: [
          { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
          { typeId: 'EMAIL', valueType: 'WORK', value: 'an@example.com' },
        ],
      },
    });

    expect(decode(command)).toEqual({
      entityTypeId: '1',
      'fields[title]': 'An',
      'fields[opportunity]': '1500000',
      'fields[fm][0][typeId]': 'PHONE',
      'fields[fm][0][valueType]': 'WORK',
      'fields[fm][0][value]': '+84901234567',
      'fields[fm][1][typeId]': 'EMAIL',
      'fields[fm][1][valueType]': 'WORK',
      'fields[fm][1][value]': 'an@example.com',
    });
  });

  it('should keep Vietnamese text and the characters & = + ? # % intact', () => {
    const title = 'Nguyễn Văn Ân - R&D = 1+1? #1 100% "ok"';
    const command = encodeBatchCommand('crm.item.update', { id: 7, fields: { title } });

    expect(command.split('?')).toHaveLength(2);
    expect(command.split('&')).toHaveLength(2);
    expect(decode(command)).toEqual({ id: '7', 'fields[title]': title });
  });

  it('should support object keys that are multifield ids or contain special characters', () => {
    const command = encodeBatchCommand('crm.item.update', {
      fields: { fm: { 4521: { value: 'a@x.vn' }, n0: { value: 'b@x.vn' } }, 'a&b': 1 },
    });

    expect(decode(command)).toEqual({
      'fields[fm][4521][value]': 'a@x.vn',
      'fields[fm][n0][value]': 'b@x.vn',
      'fields[a&b]': '1',
    });
  });

  it('should send null as an empty value, booleans as text, and skip undefined', () => {
    expect(encodeBatchCommand('m', { a: null, b: undefined, c: true, d: '', e: [] })).toBe(
      'm?a=&c=true&d=',
    );
  });
});
