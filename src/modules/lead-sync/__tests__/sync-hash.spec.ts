import {
  canonicalJson,
  formatHashCell,
  hashMapping,
  hashRow,
  parseHashCell,
} from '../domain/sync-hash.js';
import type { LeadMapping } from '../types/index.js';

const mapping: LeadMapping = {
  version: 1,
  sheet: { headerRow: 1 },
  defaults: {},
  dedupe: { keys: ['email', 'phone'], requireAtLeastOne: true },
  fields: [{ column: 'Email', field: 'email', type: 'email', required: false, onUnknown: 'error' }],
};

describe('sync-hash', () => {
  it('should serialise objects with sorted keys and drop undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 'ế' }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":"ế","z":1}]},"b":1}',
    );
  });

  it('should give the same hash whatever the key order', () => {
    const hash = hashMapping(mapping);

    expect(hashRow({ name: 'An', phone: '+84901234567' }, hash)).toBe(
      hashRow({ phone: '+84901234567', name: 'An' }, hash),
    );
    expect(hashRow({ name: 'An' }, hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should change the row hash when the content or the mapping changes', () => {
    const hash = hashMapping(mapping);
    const other = hashMapping({ ...mapping, defaults: { stageId: 'NEW' } });

    expect(hashRow({ name: 'An' }, hash)).not.toBe(hashRow({ name: 'Anh' }, hash));
    expect(hashRow({ name: 'An' }, hash)).not.toBe(hashRow({ name: 'An' }, other));
  });

  it('should format and parse the Sync Hash cell', () => {
    expect(formatHashCell('v1', 'abc')).toBe('v1:abc');
    expect(parseHashCell(' invalid:abc ')).toEqual({ kind: 'invalid', hash: 'abc' });
    expect(parseHashCell('v1:abc')).toEqual({ kind: 'v1', hash: 'abc' });
  });

  it.each(['', 'abc', 'v2:abc', 'v1:', '1.2E+45'])('should treat %j as "no hash"', (cellValue) => {
    expect(parseHashCell(cellValue)).toBeNull();
  });
});
