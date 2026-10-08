import { HASH_KIND, SYNC_STATUS } from '../constants/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type {
  DuplicateMatches,
  DuplicateQuery,
  PendingRow,
  PlannedOp,
  RowFailure,
  RowState,
  TransformedRow,
} from '../types/index.js';
import { formatHashCell, parseHashCell } from './sync-hash.js';

export type Classification = {
  /** Rows that need nothing: already synced and unchanged, or reported and not fixed yet. */
  skipped: number;
  failures: RowFailure[];
  pending: PendingRow[];
  /** Lead ID → row number that owns it in this run. `planBatch` adds to it. */
  owners: Map<number, number>;
};

export type BatchPlan = { ops: PlannedOp[]; failures: RowFailure[] };

const BLANK_STATE: RowState = { leadId: '', status: '', error: '', hash: '' };
const LEAD_ID = /^[1-9]\d*$/;
const { ROW } = LEAD_SYNC_MESSAGES;

/**
 * First pass over every row of the Sheet, in row order, using only what the Sheet itself says
 * (no network). Decides per row: nothing to do, failed, or pending.
 *
 * One lead belongs to one row, the upper one: a lower row with the same email, phone or Lead ID
 * fails with "Trùng với hàng N". That failure carries no hash because it depends on another row.
 */
export function classifyRows(
  rows: TransformedRow[],
  states: ReadonlyMap<number, RowState>,
  options: { force: boolean },
): Classification {
  const result: Classification = { skipped: 0, failures: [], pending: [], owners: new Map() };
  const emailOwners = new Map<string, number>();
  const phoneOwners = new Map<string, number>();

  for (const row of rows) {
    if (row.kind === 'empty') continue;

    const { rowNumber } = row;
    const state = states.get(rowNumber) ?? BLANK_STATE;
    const stored = parseHashCell(state.hash);
    const rejectedAsIs =
      state.status === SYNC_STATUS.ERROR &&
      stored?.kind === HASH_KIND.INVALID &&
      stored.hash === row.hash;

    if (row.kind === 'invalid') {
      if (rejectedAsIs) result.skipped += 1;
      else {
        result.failures.push({
          rowNumber,
          code: 'VALIDATION',
          message: row.errors.join('; '),
          hashCell: formatHashCell(HASH_KIND.INVALID, row.hash),
        });
      }
      continue;
    }

    if (state.leadId && !LEAD_ID.test(state.leadId)) {
      result.failures.push({ rowNumber, code: 'LEAD_ID_INVALID', message: ROW.LEAD_ID_INVALID });
      continue;
    }
    const leadId = state.leadId ? Number(state.leadId) : undefined;

    const upperRow =
      (row.email !== undefined ? emailOwners.get(row.email) : undefined) ??
      (row.phone !== undefined ? phoneOwners.get(row.phone) : undefined) ??
      (leadId !== undefined ? result.owners.get(leadId) : undefined);
    if (upperRow !== undefined) {
      const message = ROW.DUPLICATE_ROW(upperRow);
      result.failures.push({
        rowNumber,
        code: 'DUPLICATE_ROW',
        message,
        unchanged: state.status === SYNC_STATUS.ERROR && state.error === message,
      });
      continue;
    }
    if (row.email !== undefined) emailOwners.set(row.email, rowNumber);
    if (row.phone !== undefined) phoneOwners.set(row.phone, rowNumber);
    if (leadId !== undefined) result.owners.set(leadId, rowNumber);

    // Skipping needs an explicit "Đã đồng bộ" (or "Lỗi" for a rejected row): a blank or
    // "Chờ xử lý" status is the admin's way to force one row, and a row without Lead ID always
    // goes through the duplicate search, whatever its status says.
    const syncedAsIs =
      leadId !== undefined &&
      state.status === SYNC_STATUS.SYNCED &&
      stored?.kind === HASH_KIND.SYNCED &&
      stored.hash === row.hash;

    if (!options.force && (rejectedAsIs || syncedAsIs)) {
      result.skipped += 1;
      continue;
    }
    result.pending.push(leadId === undefined ? { row } : { row, leadId });
  }

  return result;
}

/** One `findbycomm` command per value of every row that is not linked to a lead yet. */
export function buildDuplicateQueries(pending: PendingRow[]): DuplicateQuery[] {
  const queries: DuplicateQuery[] = [];
  for (const { row, leadId } of pending) {
    if (leadId !== undefined) continue;
    if (row.email !== undefined) {
      queries.push({ key: `r${row.rowNumber}e`, type: 'EMAIL', value: row.email });
    }
    if (row.phone !== undefined) {
      queries.push({ key: `r${row.rowNumber}p`, type: 'PHONE', value: row.phone });
    }
  }
  return queries;
}

export function toMatches(
  pending: PendingRow[],
  found: ReadonlyMap<string, number[]>,
): Map<number, DuplicateMatches> {
  return new Map(
    pending.map(({ row }) => [
      row.rowNumber,
      {
        byEmail: found.get(`r${row.rowNumber}e`) ?? [],
        byPhone: found.get(`r${row.rowNumber}p`) ?? [],
      },
    ]),
  );
}

/**
 * Second pass, per batch, once Bitrix24 answered the duplicate search. A row linked to a lead
 * updates it. Otherwise an email match beats a phone match and the oldest lead (lowest ID) wins;
 * no match means create. A lead already owned by another row fails the lower row.
 *
 * Planning the same batch twice gives the same plan, which is what re-planning after a write
 * timeout relies on.
 */
export function planBatch(
  pending: PendingRow[],
  matches: ReadonlyMap<number, DuplicateMatches>,
  owners: Map<number, number>,
): BatchPlan {
  const plan: BatchPlan = { ops: [], failures: [] };

  for (const { row, leadId } of pending) {
    if (leadId !== undefined) {
      plan.ops.push({ row, action: 'update', leadId, otherMatches: [] });
      continue;
    }

    const found = matches.get(row.rowNumber) ?? { byEmail: [], byPhone: [] };
    const byEmail = [...found.byEmail].sort((a, b) => a - b);
    const byPhone = [...found.byPhone].sort((a, b) => a - b);
    const [target] = byEmail.length ? byEmail : byPhone;
    if (target === undefined) {
      plan.ops.push({ row, action: 'create', otherMatches: [] });
      continue;
    }

    const owner = owners.get(target);
    if (owner !== undefined && owner !== row.rowNumber) {
      plan.failures.push({
        rowNumber: row.rowNumber,
        code: 'DUPLICATE_ROW',
        message: ROW.DUPLICATE_ROW(owner),
      });
      continue;
    }
    owners.set(target, row.rowNumber);
    const otherMatches = [...new Set([...byEmail, ...byPhone])].filter((id) => id !== target);
    plan.ops.push({ row, action: 'update', leadId: target, otherMatches });
  }

  return plan;
}
