import { chunk } from '../domain/chunk.js';
import {
  buildDuplicateQueries,
  classifyRows,
  planBatch,
  toMatches,
} from '../domain/sync-planner.js';
import type { InvalidRow, PendingRow, RowState, TransformedRow, ValidRow } from '../types/index.js';

const valid = (rowNumber: number, overrides: Partial<ValidRow> = {}): ValidRow => ({
  kind: 'valid',
  rowNumber,
  fields: { name: `Khách ${rowNumber}` },
  email: `khach${rowNumber}@example.com`,
  phone: `+8490000${String(rowNumber).padStart(4, '0')}`,
  hash: `hash${rowNumber}`,
  ...overrides,
});

const invalid = (rowNumber: number, hash = `bad${rowNumber}`): InvalidRow => ({
  kind: 'invalid',
  rowNumber,
  errors: ['Cột "Email": email sai định dạng', 'Cột "Tên khách hàng": không được để trống'],
  hash,
});

const state = (overrides: Partial<RowState> = {}): RowState => ({
  leadId: '',
  status: '',
  error: '',
  hash: '',
  ...overrides,
});

const classify = (
  rows: TransformedRow[],
  states: Record<number, Partial<RowState>> = {},
  force = false,
) =>
  classifyRows(
    rows,
    new Map(Object.entries(states).map(([row, value]) => [Number(row), state(value)])),
    { force },
  );

describe('chunk', () => {
  it('should split a list into groups of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 25)).toEqual([]);
    expect(chunk([1, 2], 25)).toEqual([[1, 2]]);
  });
});

describe('classifyRows (decision table of §6.2)', () => {
  it('should ignore an empty row entirely', () => {
    expect(classify([{ kind: 'empty', rowNumber: 2 }])).toEqual({
      skipped: 0,
      failures: [],
      pending: [],
      owners: new Map(),
    });
  });

  it('should fail a row with bad data and remember its hash as invalid', () => {
    const result = classify([invalid(2)]);

    expect(result.failures).toEqual([
      {
        rowNumber: 2,
        code: 'VALIDATION',
        message: 'Cột "Email": email sai định dạng; Cột "Tên khách hàng": không được để trống',
        hashCell: 'invalid:bad2',
      },
    ]);
    expect(result.pending).toEqual([]);
  });

  it('should skip a bad row the user has not edited since it was reported', () => {
    const result = classify([invalid(2)], { 2: { status: 'Lỗi', hash: 'invalid:bad2' } });

    expect(result).toMatchObject({ skipped: 1, failures: [] });
  });

  it('should report a bad row again once it was edited or reset to "Chờ xử lý"', () => {
    expect(
      classify([invalid(2, 'bad-new')], { 2: { status: 'Lỗi', hash: 'invalid:bad2' } }).failures,
    ).toHaveLength(1);
    expect(
      classify([invalid(2)], { 2: { status: 'Chờ xử lý', hash: 'invalid:bad2' } }).failures,
    ).toHaveLength(1);
  });

  it('should queue a row without Lead ID for duplicate search', () => {
    const row = valid(2);

    expect(classify([row]).pending).toEqual([{ row }]);
    expect(classify([row], { 2: { status: 'Đã đồng bộ', hash: 'v1:hash2' } }).pending).toEqual([
      { row },
    ]);
  });

  it('should skip a synced row whose hash did not change', () => {
    const result = classify([valid(2)], {
      2: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:hash2' },
    });

    expect(result).toMatchObject({ skipped: 1, pending: [], failures: [] });
    expect(result.owners).toEqual(new Map([[912, 2]]));
  });

  it('should update a synced row whose hash changed', () => {
    const row = valid(2);

    expect(
      classify([row], { 2: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:old' } }).pending,
    ).toEqual([{ row, leadId: 912 }]);
  });

  it.each(['Chờ xử lý', ''])(
    'should update a linked row whose status is %j even when the hash is the same',
    (status) => {
      const row = valid(2);

      expect(classify([row], { 2: { leadId: '912', status, hash: 'v1:hash2' } }).pending).toEqual([
        { row, leadId: 912 },
      ]);
    },
  );

  it('should retry a linked row left in "Lỗi" by a temporary failure', () => {
    const row = valid(2);

    expect(
      classify([row], { 2: { leadId: '912', status: 'Lỗi', hash: 'v1:hash2' } }).pending,
    ).toEqual([{ row, leadId: 912 }]);
  });

  it('should skip a row Bitrix24 rejected until it is edited or reset', () => {
    const rejected = { status: 'Lỗi', hash: 'invalid:hash2' };

    expect(classify([valid(2)], { 2: rejected })).toMatchObject({ skipped: 1, pending: [] });
    expect(classify([valid(2, { hash: 'edited' })], { 2: rejected }).pending).toHaveLength(1);
    expect(classify([valid(2)], { 2: { ...rejected, status: 'Chờ xử lý' } }).pending).toHaveLength(
      1,
    );
  });

  it('should send every valid row again when forced', () => {
    const result = classify(
      [valid(2), valid(3)],
      {
        2: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:hash2' },
        3: { status: 'Lỗi', hash: 'invalid:hash3' },
      },
      true,
    );

    expect(result.skipped).toBe(0);
    expect(result.pending.map((item) => item.row.rowNumber)).toEqual([2, 3]);
  });

  it.each(['abc', '12.5', '-3', '0', '9 12'])(
    'should fail a row whose Lead ID cell holds %j instead of sending it',
    (leadId) => {
      const result = classify([valid(2)], {
        2: { leadId, status: 'Đã đồng bộ', hash: 'v1:hash2' },
      });

      expect(result.pending).toEqual([]);
      expect(result.failures).toEqual([
        {
          rowNumber: 2,
          code: 'LEAD_ID_INVALID',
          message: 'Ô Lead ID Bitrix24 không phải số nguyên dương; xóa nội dung ô để đồng bộ lại',
        },
      ]);
    },
  );
});

describe('classifyRows (duplicates inside the Sheet, §6.3)', () => {
  const duplicateOf = (rowNumber: number): string =>
    `Trùng với hàng ${rowNumber}: đổi email hoặc số điện thoại rồi xóa ô Lead ID để tạo lead mới`;

  it('should keep the upper row and fail the lower one with the same email', () => {
    const result = classify([valid(2), valid(5, { email: 'khach2@example.com' })]);

    expect(result.pending.map((item) => item.row.rowNumber)).toEqual([2]);
    expect(result.failures).toEqual([
      { rowNumber: 5, code: 'DUPLICATE_ROW', message: duplicateOf(2), unchanged: false },
    ]);
  });

  it('should detect the same phone and the same Lead ID as well', () => {
    const samePhone = classify([valid(2), valid(3, { phone: '+84900000002' })]);
    expect(samePhone.failures[0]).toMatchObject({ rowNumber: 3, message: duplicateOf(2) });

    const sameLead = classify([valid(2), valid(3)], {
      2: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:hash2' },
      3: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:hash3' },
    });
    expect(sameLead.failures[0]).toMatchObject({ rowNumber: 3, message: duplicateOf(2) });
    expect(sameLead.skipped).toBe(1);
  });

  it('should compare against rows that are skipped, not only against rows being sent', () => {
    const result = classify([valid(2), valid(9, { email: 'khach2@example.com' })], {
      2: { leadId: '912', status: 'Đã đồng bộ', hash: 'v1:hash2' },
    });

    expect(result.failures[0]).toMatchObject({ rowNumber: 9, message: duplicateOf(2) });
  });

  it('should not write a hash for a duplicate: deleting the upper row heals the lower one', () => {
    const result = classify([valid(2), valid(5, { email: 'khach2@example.com' })]);

    expect(result.failures[0]).not.toHaveProperty('hashCell');
  });

  it('should mark a duplicate the Sheet already reports as unchanged', () => {
    const result = classify([valid(2), valid(5, { email: 'khach2@example.com' })], {
      5: { status: 'Lỗi', error: duplicateOf(2) },
    });

    expect(result.failures[0]).toMatchObject({ rowNumber: 5, unchanged: true });
  });

  it('should not let a failed row claim its keys', () => {
    const result = classify([
      valid(2),
      valid(3, { email: 'khach2@example.com', phone: '+84911111111' }),
      valid(4, { phone: '+84911111111' }),
    ]);

    expect(result.failures.map((failure) => failure.rowNumber)).toEqual([3]);
    expect(result.pending.map((item) => item.row.rowNumber)).toEqual([2, 4]);
  });

  it('should let two rows without email share nothing by accident', () => {
    const result = classify([valid(2, { email: undefined }), valid(3, { email: undefined })]);

    expect(result.failures).toEqual([]);
    expect(result.pending).toHaveLength(2);
  });
});

describe('buildDuplicateQueries / toMatches', () => {
  it('should ask one question per value, only for rows without a Lead ID', () => {
    const pending: PendingRow[] = [
      { row: valid(12) },
      { row: valid(13, { email: undefined }) },
      { row: valid(14, { phone: undefined }) },
      { row: valid(15), leadId: 345 },
    ];

    expect(buildDuplicateQueries(pending)).toEqual([
      { key: 'r12e', type: 'EMAIL', value: 'khach12@example.com' },
      { key: 'r12p', type: 'PHONE', value: '+84900000012' },
      { key: 'r13p', type: 'PHONE', value: '+84900000013' },
      { key: 'r14e', type: 'EMAIL', value: 'khach14@example.com' },
    ]);
  });

  it('should produce at most 50 queries for a batch of 25 rows', () => {
    const pending = Array.from({ length: 25 }, (_unused, index) => ({ row: valid(index + 2) }));

    expect(buildDuplicateQueries(pending)).toHaveLength(50);
  });

  it('should group the answers by row', () => {
    const pending: PendingRow[] = [{ row: valid(12) }, { row: valid(13) }];
    const found = new Map([
      ['r12e', [345]],
      ['r12p', [900, 345]],
    ]);

    expect(toMatches(pending, found)).toEqual(
      new Map([
        [12, { byEmail: [345], byPhone: [900, 345] }],
        [13, { byEmail: [], byPhone: [] }],
      ]),
    );
  });
});

describe('planBatch', () => {
  const none = { byEmail: [], byPhone: [] };

  it('should create a lead when nothing matches', () => {
    const row = valid(13);

    expect(planBatch([{ row }], new Map([[13, none]]), new Map())).toEqual({
      ops: [{ row, action: 'create', otherMatches: [] }],
      failures: [],
    });
  });

  it('should update the lead a row is already linked to without looking at matches', () => {
    const row = valid(12);

    expect(planBatch([{ row, leadId: 345 }], new Map(), new Map([[345, 12]]))).toEqual({
      ops: [{ row, action: 'update', leadId: 345, otherMatches: [] }],
      failures: [],
    });
  });

  it('should update the matching lead instead of creating a duplicate (TC3)', () => {
    const row = valid(12);
    const owners = new Map<number, number>();

    const plan = planBatch([{ row }], new Map([[12, { byEmail: [345], byPhone: [] }]]), owners);

    expect(plan.ops).toEqual([{ row, action: 'update', leadId: 345, otherMatches: [] }]);
    expect(owners.get(345)).toBe(12);
  });

  it('should prefer an email match over a phone match, and the oldest lead among several', () => {
    const row = valid(12);

    const plan = planBatch(
      [{ row }],
      new Map([[12, { byEmail: [700, 345, 512], byPhone: [100] }]]),
      new Map(),
    );

    expect(plan.ops[0]).toMatchObject({
      action: 'update',
      leadId: 345,
      otherMatches: [512, 700, 100],
    });
  });

  it('should fall back to the phone match when the email matches nothing', () => {
    const plan = planBatch(
      [{ row: valid(12) }],
      new Map([[12, { byEmail: [], byPhone: [222, 111] }]]),
      new Map(),
    );

    expect(plan.ops[0]).toMatchObject({ action: 'update', leadId: 111 });
  });

  it('should fail the lower of two rows that resolve to the same lead', () => {
    const plan = planBatch(
      [{ row: valid(5) }, { row: valid(9) }],
      new Map([
        [5, { byEmail: [345], byPhone: [] }],
        [9, { byEmail: [], byPhone: [345] }],
      ]),
      new Map(),
    );

    expect(plan.ops.map((op) => op.row.rowNumber)).toEqual([5]);
    expect(plan.failures).toEqual([
      {
        rowNumber: 9,
        code: 'DUPLICATE_ROW',
        message: 'Trùng với hàng 5: đổi email hoặc số điện thoại rồi xóa ô Lead ID để tạo lead mới',
      },
    ]);
  });

  it('should fail a new row that matches a lead another row already holds', () => {
    const plan = planBatch(
      [{ row: valid(9) }],
      new Map([[9, { byEmail: [912], byPhone: [] }]]),
      new Map([[912, 2]]),
    );

    expect(plan.ops).toEqual([]);
    expect(plan.failures[0]).toMatchObject({ rowNumber: 9, code: 'DUPLICATE_ROW' });
  });

  it('should give the same plan when the same batch is planned again after a timeout', () => {
    const owners = new Map<number, number>();
    const pending: PendingRow[] = [{ row: valid(5) }];
    const matches = new Map([[5, { byEmail: [345], byPhone: [] }]]);

    const first = planBatch(pending, matches, owners);
    const again = planBatch(pending, matches, owners);

    expect(again).toEqual(first);
    expect(again.failures).toEqual([]);
  });
});
