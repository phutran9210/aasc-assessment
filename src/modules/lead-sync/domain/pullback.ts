import { HASH_KIND } from '../constants/index.js';
import type { BitrixLeadItem, MappingField, SheetRow } from '../types/index.js';
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

/** Column types whose value is picked in Bitrix24 and has a label in the mapping. */
const PULLED_TYPES: readonly string[] = ['enum', 'user'];

/**
 * Bitrix24 → Sheet, for rows already linked to a lead. Only columns with a value table flow
 * back (stage, assignee): their Bitrix24 code is turned into the label the Sheet uses.
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
  const pulled = context.mapping.fields.filter((field) => PULLED_TYPES.includes(field.type));

  for (const row of rows) {
    const lead = /^\d+$/.test(row.state.leadId) ? leads.get(Number(row.state.leadId)) : undefined;
    if (!lead) continue;

    const before = transformRow(row, context);
    const cells: Record<string, string> = {};
    for (const field of pulled) {
      const code = lead[field.field];
      if (typeof code !== 'string' && typeof code !== 'number') continue;
      const sent = before.kind === 'valid' ? before.fields[field.field] : undefined;
      if (String(sent) === String(code)) continue;
      const label = labelOf(field, code);
      if (label !== undefined) cells[field.column] = label;
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
