import { buildLeadDiff } from '../domain/crm-lead-diff.js';
import type { CompiledMapping } from '../domain/mapping-compiler.js';

const compiled: CompiledMapping = {
  entries: [
    { sourcePath: ['name'], target: 'name', subfield: null, transforms: [], owner: 'integration' },
    {
      sourcePath: ['email'],
      target: 'fm',
      subfield: 'EMAIL',
      transforms: [],
      owner: 'integration',
    },
    { sourcePath: ['phone'], target: 'fm', subfield: 'PHONE', transforms: [], owner: 'manual' },
    { sourcePath: ['city'], target: 'city', subfield: null, transforms: [], owner: 'integration' },
  ],
};

describe('buildLeadDiff', () => {
  it('creates and updates integration-owned fields while skipping manual-owned fields', () => {
    const result = buildLeadDiff(
      {
        name: 'Ada',
        fm: [{ typeId: 'EMAIL', valueType: 'WORK', value: 'ada@example.test' }],
        city: 'London',
      },
      { name: 'Old', fm: [], city: 'Paris' },
      {},
      compiled,
    );

    expect(result.patch).toMatchObject({ name: 'Ada', city: 'London' });
    expect(result.patch.fm).toEqual([
      { typeId: 'EMAIL', valueType: 'WORK', value: 'ada@example.test' },
    ]);
    expect(result.lastWrittenFields).toMatchObject({ name: 'Ada', city: 'London' });
  });

  it('does not overwrite a remote field changed since the integration last wrote it', () => {
    const result = buildLeadDiff(
      { name: 'Latest TikTok Name', city: 'Hanoi' },
      { name: 'Sales edited name', city: 'Hanoi' },
      { name: 'Previous TikTok Name', city: 'Hanoi' },
      compiled,
    );

    expect(result.patch).not.toHaveProperty('name');
    expect(result.patch).not.toHaveProperty('city');
    expect(result.lastWrittenFields.name).toBe('Previous TikTok Name');
  });

  it('preserves remote-added multifields and their IDs while appending mapped values', () => {
    const result = buildLeadDiff(
      {
        name: 'Ada',
        fm: [{ typeId: 'EMAIL', valueType: 'WORK', value: 'ada@example.test' }],
      },
      {
        name: 'Ada',
        fm: [
          { ID: '501', TYPE_ID: 'PHONE', VALUE_TYPE: 'WORK', VALUE: '+84901234567' },
          { ID: '502', TYPE_ID: 'EMAIL', VALUE_TYPE: 'HOME', VALUE: 'sales@example.test' },
        ],
      },
      {},
      compiled,
    );

    expect(result.patch.fm).toEqual([
      { ID: '501', TYPE_ID: 'PHONE', VALUE_TYPE: 'WORK', VALUE: '+84901234567' },
      { ID: '502', TYPE_ID: 'EMAIL', VALUE_TYPE: 'HOME', VALUE: 'sales@example.test' },
      { typeId: 'EMAIL', valueType: 'WORK', value: 'ada@example.test' },
    ]);
  });

  it('does not restore a multifield that sales removed after the last integration write', () => {
    const prior = [{ typeId: 'EMAIL', valueType: 'WORK', value: 'old@example.test' }];
    const result = buildLeadDiff(
      { fm: [{ typeId: 'EMAIL', valueType: 'WORK', value: 'new@example.test' }] },
      { fm: [] },
      { fm: prior },
      compiled,
    );

    expect(result.patch).not.toHaveProperty('fm');
    expect(result.lastWrittenFields.fm).toEqual(prior);
  });

  it('returns no patch for null, empty, or already-synchronized values', () => {
    const result = buildLeadDiff(
      { name: '', city: null, fm: [] },
      { name: 'Ada', city: 'Hanoi', fm: [] },
      { name: 'Ada', city: 'Hanoi' },
      compiled,
    );

    expect(result.patch).toEqual({});
  });
});
