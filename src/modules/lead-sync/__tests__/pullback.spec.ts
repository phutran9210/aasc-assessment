import { planNewRows, planPullback } from '../domain/pullback.js';
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

  it('should respect pull=false and leave a pullback that would make a row invalid untouched', () => {
    const custom: TransformContext = {
      ...context,
      mapping: {
        ...mapping,
        fields: [
          ...mapping.fields.map((field) =>
            field.field === 'name' ? { ...field, pull: true } : field,
          ),
          {
            column: 'CRM title',
            field: 'companyTitle',
            type: 'string',
            required: false,
            pull: false,
            onUnknown: 'error',
          },
        ],
      },
    };
    const row = syncedRow({ ...BASE, 'CRM title': 'Sheet title' }, '10');
    row.state.hash = formatHashCell('v1', (transformRow(row, custom) as ValidRow).hash);
    const plan = planPullback(
      [row],
      leads(lead({ stageId: 'NEW', companyTitle: 'CRM title', name: '' })),
      custom,
    );
    expect(plan).toEqual({ writes: [], conflicts: [], unchanged: [] });
  });

  describe('columns marked "pull": true', () => {
    const withPull: TransformContext = {
      ...context,
      mapping: {
        ...mapping,
        fields: [
          ...mapping.fields,
          {
            column: 'Công ty',
            field: 'companyTitle',
            type: 'string',
            required: false,
            onUnknown: 'error',
            pull: true,
          },
          {
            column: 'Ngân sách',
            field: 'opportunity',
            type: 'number',
            required: false,
            onUnknown: 'error',
            pull: true,
          },
          {
            column: 'Ghi chú',
            field: 'comments',
            type: 'string',
            required: false,
            onUnknown: 'error',
          },
        ],
      },
      mappingHash: 'pull-mapping',
    };
    const synced = (cells: Record<string, string>): SheetRow => {
      const row = syncedRow(cells, '10');
      row.state.hash = formatHashCell('v1', (transformRow(row, withPull) as ValidRow).hash);
      return row;
    };
    const FULL = { ...BASE, 'Công ty': 'ACME', 'Ngân sách': '1.500.000 ₫', 'Ghi chú': 'cũ' };

    it('should write a changed text and a changed number, as plain values', () => {
      const plan = planPullback(
        [synced(FULL)],
        leads(
          lead({
            stageId: 'NEW',
            companyTitle: 'ACME Việt Nam',
            opportunity: 2000000,
            comments: 'cũ',
          }),
        ),
        withPull,
      );

      expect(plan.writes[0].cells).toEqual({ 'Công ty': 'ACME Việt Nam', 'Ngân sách': '2000000' });
    });

    it('should not touch a column that is not marked, whatever Bitrix24 holds', () => {
      const plan = planPullback(
        [synced(FULL)],
        leads(
          lead({ stageId: 'NEW', companyTitle: 'ACME', opportunity: 1500000, comments: 'mới' }),
        ),
        withPull,
      );

      expect(plan.unchanged).toEqual([2]);
    });

    it('should treat a blank cell and an empty or zero Bitrix24 value as the same', () => {
      const plan = planPullback(
        [synced(BASE)],
        leads(lead({ stageId: 'NEW', companyTitle: null, opportunity: 0 })),
        withPull,
      );

      expect(plan.unchanged).toEqual([2]);
    });

    it('should clear the cell when the value was removed in Bitrix24', () => {
      const plan = planPullback(
        [synced(FULL)],
        leads(lead({ stageId: 'NEW', companyTitle: '', opportunity: 1500000 })),
        withPull,
      );

      expect(plan.writes[0].cells).toEqual({ 'Công ty': '' });
    });
  });

  describe('planNewRows', () => {
    const fresh = (fields: Record<string, unknown>): BitrixLeadItem => ({
      id: 77,
      name: 'Giang',
      stageId: 'IN_PROCESS',
      assignedById: 9,
      fm: [
        { id: 1, typeId: 'EMAIL', valueType: 'WORK', value: 'giang@congty.vn' },
        { id: 2, typeId: 'EMAIL', valueType: 'HOME', value: 'giang.2@congty.vn' },
      ],
      ...fields,
    });

    it('should turn a lead created in Bitrix24 into a row placed after the last one', () => {
      const existing = syncedRow(BASE, '10', 5);

      const plan = planNewRows([existing], [fresh({})], context);

      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        rowNumber: 6,
        leadId: 77,
        cells: {
          'Tên khách hàng': 'Giang',
          Email: 'giang@congty.vn, giang.2@congty.vn',
          'Trạng thái': 'Đang liên hệ',
          'Người phụ trách': 'Bình Trần',
        },
      });
      expect(plan[0].hash).toMatch(/^v1:[0-9a-f]{64}$/);
    });

    it('should number several new rows one after the other', () => {
      const plan = planNewRows(
        [syncedRow(BASE, '10', 2)],
        [fresh({}), fresh({ id: 78, fm: [{ typeId: 'EMAIL', value: 'khac@congty.vn' }] })],
        context,
      );

      expect(plan.map((row) => [row.rowNumber, row.leadId])).toEqual([
        [3, 77],
        [4, 78],
      ]);
    });

    it('should skip a lead this sync created itself', () => {
      expect(planNewRows([], [fresh({ originatorId: 'google-sheets' })], context)).toEqual([]);
    });

    it('should skip a lead whose email is already in a row waiting to be linked', () => {
      const waiting = syncedRow({ ...BASE, Email: 'giang@congty.vn' }, '', 2);

      expect(planNewRows([waiting], [fresh({})], context)).toEqual([]);
    });

    it('should leave the hash empty when the lead cannot make a valid row', () => {
      const plan = planNewRows([], [fresh({ fm: [] })], context);

      expect(plan[0]).toMatchObject({ rowNumber: 2, leadId: 77, hash: '' });
    });

    it('should format phone, date and zero-valued numeric fields when adding a Bitrix lead', () => {
      const extended: TransformContext = {
        ...context,
        mapping: {
          ...mapping,
          fields: [
            ...mapping.fields,
            {
              column: 'Điện thoại',
              field: 'phone',
              type: 'phone',
              required: false,
              onUnknown: 'error',
            },
            {
              column: 'Ngày tạo',
              field: 'dateCreate',
              type: 'date',
              required: false,
              onUnknown: 'error',
            },
            {
              column: 'Giá trị',
              field: 'opportunity',
              type: 'number',
              required: false,
              pull: true,
              onUnknown: 'error',
            },
          ],
        },
      };
      const plan = planNewRows(
        [],
        [
          fresh({
            dateCreate: '2026-02-03T12:00:00Z',
            opportunity: 0,
            fm: [{ typeId: 'PHONE', value: '+84901234567' }],
          }),
        ],
        extended,
      );
      expect(plan[0]?.cells).toMatchObject({
        'Điện thoại': '+84901234567',
        'Ngày tạo': '2026-02-03',
        'Giá trị': '',
      });
    });
  });
});
