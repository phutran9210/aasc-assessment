import { planPullback } from '../domain/pullback.js';
import { transformRow } from '../domain/row-transformer.js';
import type { TransformContext } from '../domain/row-transformer.js';
import { formatHashCell, hashMapping } from '../domain/sync-hash.js';
import type { BitrixLeadItem, LeadMapping, SheetRow, ValidRow } from '../types/index.js';

const mapping: LeadMapping = {
  version: 1,
  sheet: { headerRow: 1 },
  defaults: { stageId: 'NEW', assignedById: 1 },
  dedupe: { keys: ['email', 'phone'], requireAtLeastOne: true },
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true, onUnknown: 'error' },
    { column: 'Email', field: 'email', type: 'email', required: false, onUnknown: 'error' },
    {
      column: 'Trạng thái',
      field: 'stageId',
      type: 'enum',
      required: false,
      values: { Mới: 'NEW', 'Đang liên hệ': 'IN_PROCESS', 'Đã xử lý': 'PROCESSED' },
      onUnknown: 'error',
    },
    {
      column: 'Người phụ trách',
      field: 'assignedById',
      type: 'user',
      required: false,
      values: { 'An Nguyễn': 7, 'Bình Trần': 9 },
      onUnknown: 'error',
    },
  ],
};
const context: TransformContext = {
  mapping,
  mappingHash: hashMapping(mapping),
  defaultCountry: 'VN',
};

/** A row as it stands right after a successful sync: its hash cell matches its content. */
const syncedRow = (cells: Record<string, string>, leadId: string, rowNumber = 2): SheetRow => {
  const row: SheetRow = {
    rowNumber,
    cells: Object.fromEntries(
      Object.entries(cells).map(([column, value]) => [column, { formatted: value, raw: value }]),
    ),
    state: { leadId, status: 'Đã đồng bộ', error: '', hash: '' },
  };
  row.state.hash = formatHashCell('v1', (transformRow(row, context) as ValidRow).hash);
  return row;
};

const BASE = { 'Tên khách hàng': 'An', Email: 'an@congty.vn', 'Trạng thái': 'Mới' };
const lead = (fields: Record<string, unknown>): BitrixLeadItem => ({ id: 10, ...fields });
const leads = (item: BitrixLeadItem) => new Map([[Number(item.id), item]]);

describe('planPullback', () => {
  it('should write the new stage back with a hash that matches the changed row', () => {
    const row = syncedRow(BASE, '10');

    const plan = planPullback(
      [row],
      leads(lead({ stageId: 'IN_PROCESS', assignedById: 1 })),
      context,
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ rowNumber: 2, cells: { 'Trạng thái': 'Đang liên hệ' } });
    const after = syncedRow({ ...BASE, 'Trạng thái': 'Đang liên hệ' }, '10');
    expect(plan.writes[0].hash).toBe(after.state.hash);
  });

  it('should write the name of the new assignee', () => {
    const row = syncedRow({ ...BASE, 'Người phụ trách': 'An Nguyễn' }, '10');

    const plan = planPullback([row], leads(lead({ stageId: 'NEW', assignedById: 9 })), context);

    expect(plan.writes[0].cells).toEqual({ 'Người phụ trách': 'Bình Trần' });
  });

  it('should change nothing when Bitrix24 holds what the Sheet shows', () => {
    const row = syncedRow({ ...BASE, 'Người phụ trách': 'An Nguyễn' }, '10');

    const plan = planPullback([row], leads(lead({ stageId: 'NEW', assignedById: '7' })), context);

    expect(plan).toEqual({ writes: [], conflicts: [], unchanged: [2] });
  });

  it('should leave a blank assignee cell alone while the lead has the default assignee', () => {
    const row = syncedRow(BASE, '10');

    const plan = planPullback([row], leads(lead({ stageId: 'NEW', assignedById: 1 })), context);

    expect(plan.unchanged).toEqual([2]);
  });

  it('should let the Sheet win when the row was edited after its last sync', () => {
    const row = syncedRow(BASE, '10');
    row.cells['Tên khách hàng'] = { formatted: 'An Nguyễn Văn', raw: 'An Nguyễn Văn' };

    const plan = planPullback([row], leads(lead({ stageId: 'PROCESSED' })), context);

    expect(plan).toEqual({ writes: [], conflicts: [2], unchanged: [] });
  });

  it('should ignore a stage or an assignee the mapping has no label for', () => {
    const row = syncedRow(BASE, '10');

    const plan = planPullback([row], leads(lead({ stageId: 'JUNK', assignedById: 55 })), context);

    expect(plan.unchanged).toEqual([2]);
  });

  it('should skip rows without a lead ID and rows whose lead was not fetched', () => {
    const unlinked = syncedRow(BASE, '', 2);
    const other = syncedRow(BASE, '99', 3);

    const plan = planPullback([unlinked, other], leads(lead({ stageId: 'PROCESSED' })), context);

    expect(plan).toEqual({ writes: [], conflicts: [], unchanged: [] });
  });
});
