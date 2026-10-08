import {
  HASH_KIND,
  LEAD_ORIGINATOR_FIELD,
  LEAD_ORIGINATOR_ID,
  PULLABLE_TYPES,
  PULLED_BY_DEFAULT,
} from '../constants/index.js';
import type { BitrixLeadItem, BitrixMultifield, MappingField, SheetRow } from '../types/index.js';
import { transformRow } from './row-transformer.js';
import type { TransformContext } from './row-transformer.js';
import { formatHashCell } from './sync-hash.js';

/** Cells of one row to overwrite with what Bitrix24 holds, and the hash the row has afterwards. */
export type PullbackWrite = { rowNumber: number; cells: Record<string, string>; hash: string };

export type PullbackPlan = {
  writes: PullbackWrite[];
  /** Rows edited in the Sheet since their last sync: the Sheet wins, nothing is written. */
  conflicts: number[];
  unchanged: number[];
};

/**
 * Bitrix24 → Sheet, for rows already linked to a lead. Columns with a value table flow back by
 * default (stage, assignee): their Bitrix24 code is turned into the label the Sheet uses. Text
 * and number columns flow back when the mapping marks them `"pull": true`.
 *
 * Conflict rule: a row whose content no longer matches its `Sync Hash` has an edit the next
 * Sheet → Bitrix24 run will send, so the Sheet wins and the row is left alone. Otherwise the
 * cells are overwritten and the hash is recomputed for the new content, which is why the write
 * does not bounce back as a change on the next run.
 */
export function planPullback(
  rows: readonly SheetRow[],
  leads: ReadonlyMap<number, BitrixLeadItem>,
  context: TransformContext,
): PullbackPlan {
  const plan: PullbackPlan = { writes: [], conflicts: [], unchanged: [] };
  const pulled = context.mapping.fields.filter(
    (field) =>
      PULLABLE_TYPES.includes(field.type) && (field.pull ?? PULLED_BY_DEFAULT.includes(field.type)),
  );

  for (const row of rows) {
    const lead = /^\d+$/.test(row.state.leadId) ? leads.get(Number(row.state.leadId)) : undefined;
    if (!lead) continue;

    const before = transformRow(row, context);
    const cells: Record<string, string> = {};
    for (const field of pulled) {
      const sent = before.kind === 'valid' ? before.fields[field.field] : undefined;
      const cell = cellFor(field, sent, lead[field.field]);
      if (cell !== undefined) cells[field.column] = cell;
    }

    if (!Object.keys(cells).length) {
      plan.unchanged.push(row.rowNumber);
      continue;
    }
    const inSync =
      before.kind === 'valid' && formatHashCell(HASH_KIND.SYNCED, before.hash) === row.state.hash;
    if (!inSync) {
      plan.conflicts.push(row.rowNumber);
      continue;
    }

    const after = transformRow(withCells(row, cells), context);
    if (after.kind !== 'valid') continue;
    plan.writes.push({
      rowNumber: row.rowNumber,
      cells,
      hash: formatHashCell(HASH_KIND.SYNCED, after.hash),
    });
  }
  return plan;
}

/** What to write into the cell of `field`, or undefined when the Sheet already agrees. */
function cellFor(field: MappingField, sent: unknown, held: unknown): string | undefined {
  if (field.type === 'enum' || field.type === 'user') {
    if (typeof held !== 'string' && typeof held !== 'number') return undefined;
    return String(sent) === String(held) ? undefined : labelOf(field, held);
  }
  if (field.type === 'number') {
    const now = Number(held ?? 0);
    if (!Number.isFinite(now) || now === Number(sent ?? 0)) return undefined;
    return String(now);
  }
  // Text: a blank cell and an empty Bitrix24 value are the same thing.
  const now = typeof held === 'string' || typeof held === 'number' ? String(held).trim() : '';
  const was = typeof sent === 'string' || typeof sent === 'number' ? String(sent) : '';
  return now === was ? undefined : now;
}

function labelOf(field: MappingField, code: string | number): string | undefined {
  const hit = Object.entries(field.values ?? {}).find(
    ([, value]) => String(value) === String(code),
  );
  return hit?.[0];
}

function withCells(row: SheetRow, cells: Record<string, string>): SheetRow {
  const next = { ...row.cells };
  for (const [column, value] of Object.entries(cells)) {
    next[column] = { formatted: value, raw: value };
  }
  return { ...row, cells: next };
}

/** A lead to add to the Sheet as a new row. `hash` is empty when the row would not be valid. */
export type NewRow = {
  rowNumber: number;
  leadId: number;
  cells: Record<string, string>;
  hash: string;
};

/**
 * Leads created in Bitrix24 → new rows under the last one. Two kinds of lead get no row: one
 * this sync created itself (its row exists and receives the ID from the run that created it),
 * and one whose email or phone is already in a row, because the next Sheet → Bitrix24 run will
 * link that row to the lead and a second row would be a duplicate.
 */
export function planNewRows(
  rows: readonly SheetRow[],
  leads: readonly BitrixLeadItem[],
  context: TransformContext,
): NewRow[] {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const remember = (row: SheetRow): boolean => {
    const transformed = transformRow(row, context);
    if (transformed.kind !== 'valid') return false;
    const taken =
      (transformed.email !== undefined && emails.has(transformed.email)) ||
      (transformed.phone !== undefined && phones.has(transformed.phone));
    if (transformed.email !== undefined) emails.add(transformed.email);
    if (transformed.phone !== undefined) phones.add(transformed.phone);
    return taken;
  };
  for (const row of rows) remember(row);

  const plan: NewRow[] = [];
  let rowNumber = Math.max(context.mapping.sheet.headerRow, ...rows.map((row) => row.rowNumber));
  for (const lead of leads) {
    if (lead[LEAD_ORIGINATOR_FIELD] === LEAD_ORIGINATOR_ID) continue;

    const cells = Object.fromEntries(
      context.mapping.fields.map((field) => [field.column, cellOfLead(field, lead)]),
    );
    const row: SheetRow = {
      rowNumber: rowNumber + 1,
      cells: Object.fromEntries(
        Object.entries(cells).map(([column, value]) => [column, { formatted: value, raw: value }]),
      ),
      state: { leadId: String(lead.id), status: '', error: '', hash: '' },
    };
    if (remember(row)) continue;

    const transformed = transformRow(row, context);
    rowNumber += 1;
    plan.push({
      rowNumber,
      leadId: Number(lead.id),
      cells,
      hash: transformed.kind === 'valid' ? formatHashCell(HASH_KIND.SYNCED, transformed.hash) : '',
    });
  }
  return plan;
}

/** What a lead holds for `field`, written the way a user would type it into the Sheet. */
function cellOfLead(field: MappingField, lead: BitrixLeadItem): string {
  if (field.field === 'email' || field.field === 'phone') {
    const typeId = field.field === 'email' ? 'EMAIL' : 'PHONE';
    const entries = Array.isArray(lead.fm) ? (lead.fm as BitrixMultifield[]) : [];
    return entries
      .filter((entry) => entry.typeId === typeId && entry.value)
      .map((entry) => String(entry.value))
      .join(', ');
  }
  const held = lead[field.field];
  if (typeof held !== 'string' && typeof held !== 'number') return '';
  switch (field.type) {
    case 'enum':
    case 'user':
      return labelOf(field, held) ?? '';
    case 'date':
      return String(held).slice(0, 10);
    case 'number':
      return Number(held) === 0 ? '' : String(held);
    default:
      return String(held).trim();
  }
}
