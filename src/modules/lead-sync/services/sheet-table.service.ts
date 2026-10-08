import { SheetsClient } from '@modules/google-sheets/index.js';
import type {
  SheetCell,
  SheetMeta,
  SheetStructureRequest,
  ValueRangeInput,
} from '@modules/google-sheets/index.js';

import { Injectable } from '@nestjs/common';

import {
  ERROR_MESSAGE_MAX_LENGTH,
  HIDDEN_COLUMNS,
  SHEET_COLUMNS,
  TECHNICAL_COLUMNS,
} from '../constants/index.js';
import type { TechnicalColumn } from '../constants/index.js';
import { columnLetter, quoteSheetName } from '../domain/a1.js';
import { LeadSyncConfigError } from '../errors/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type { CellValue, LeadMapping, SheetRow } from '../types/index.js';

export type SheetSnapshot = {
  meta: SheetMeta;
  /** 1-based number of the header row. */
  headerRow: number;
  /** Trimmed header texts; the array index is the 0-based column index. */
  headers: string[];
  /** Header text → 0-based column index (first occurrence wins). */
  columns: Record<string, number>;
  rows: SheetRow[];
};

/**
 * Cells to write for one row, by header text. A column left out keeps its current content. The
 * normal run writes technical columns only; the Bitrix24 → Sheet pullback also writes the stage
 * and assignee cells.
 */
export type RowWrite = { rowNumber: number; cells: Partial<Record<string, string>> };

/** `drifted` rows were not written: their email or phone no longer matches what was read. */
export type WriteOutcome = { written: number[]; drifted: number[] };

const text = (value: SheetCell | undefined | null): string => String(value ?? '');

/**
 * Turns the worksheet into rows with named columns and writes sync results back. Columns are
 * always found by header text, so the user may reorder them freely.
 */
@Injectable()
export class SheetTable {
  constructor(private readonly client: SheetsClient) {}

  /**
   * Reads the whole worksheet twice: as displayed (keeps the leading zero of a phone number)
   * and as stored (keeps a budget as a plain number whatever its currency format). Read-only.
   */
  async load(mapping: LeadMapping): Promise<SheetSnapshot> {
    const meta = await this.client.getSheetMeta();
    const range = quoteSheetName(meta.title);
    const [formatted = []] = await this.client.batchGet([range], 'FORMATTED_VALUE');
    const [raw = []] = await this.client.batchGet([range], 'UNFORMATTED_VALUE');

    const { headerRow } = mapping.sheet;
    const headers = (formatted[headerRow - 1] ?? []).map((cell) => text(cell).trim());
    if (!headers.some(Boolean)) {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.HEADER_ROW_EMPTY(headerRow));
    }

    const columns: Record<string, number> = {};
    headers.forEach((header, index) => {
      if (header && !(header in columns)) columns[header] = index;
    });

    const rows: SheetRow[] = [];
    const rowCount = Math.max(formatted.length, raw.length);
    for (let index = headerRow; index < rowCount; index++) {
      const cells: Record<string, CellValue> = {};
      for (const [header, column] of Object.entries(columns)) {
        cells[header] = {
          formatted: text(formatted[index]?.[column]),
          raw: raw[index]?.[column] ?? null,
        };
      }
      const state = (column: TechnicalColumn): string => (cells[column]?.formatted ?? '').trim();
      rows.push({
        rowNumber: index + 1,
        cells,
        state: {
          leadId: state(SHEET_COLUMNS.LEAD_ID),
          status: state(SHEET_COLUMNS.STATUS),
          error: state(SHEET_COLUMNS.ERROR),
          hash: state(SHEET_COLUMNS.HASH),
        },
      });
    }

    return { meta, headerRow, headers, columns, rows };
  }

  /**
   * Adds the technical columns that are missing to the end of the header row and hides the two
   * internal ones. Needs Editor access. Updates `snapshot` so later writes find the new columns.
   */
  async ensureTechnicalColumns(snapshot: SheetSnapshot): Promise<void> {
    const missing = TECHNICAL_COLUMNS.filter((column) => !(column in snapshot.columns));
    if (!missing.length) return;

    const { meta, headerRow, headers } = snapshot;
    const start = headers.length;
    const end = start + missing.length;

    const requests: SheetStructureRequest[] = [];
    if (end > meta.columnCount) {
      requests.push({
        appendDimension: {
          sheetId: meta.sheetId,
          dimension: 'COLUMNS',
          length: end - meta.columnCount,
        },
      });
      meta.columnCount = end;
    }
    missing.forEach((column, offset) => {
      if (!HIDDEN_COLUMNS.includes(column)) return;
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: meta.sheetId,
            dimension: 'COLUMNS',
            startIndex: start + offset,
            endIndex: start + offset + 1,
          },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    });
    await this.client.batchUpdate(requests);

    const sheet = quoteSheetName(meta.title);
    await this.client.batchUpdateValues([
      {
        range: `${sheet}!${columnLetter(start)}${headerRow}:${columnLetter(end - 1)}${headerRow}`,
        values: [[...missing]],
      },
    ]);

    missing.forEach((column, offset) => {
      headers.push(column);
      snapshot.columns[column] = start + offset;
    });
  }

  /**
   * Writes result cells of several rows in one request. Results are addressed by the row number
   * read at the start of the run, so the key columns (email, phone) of those rows are read again
   * first: a row that no longer matches was moved by the user and is left untouched.
   */
  async writeResults(
    snapshot: SheetSnapshot,
    writes: RowWrite[],
    keyColumns: string[],
  ): Promise<WriteOutcome> {
    if (!writes.length) return { written: [], drifted: [] };

    const sheet = quoteSheetName(snapshot.meta.title);
    const drifted = await this.findDrifted(snapshot, writes, keyColumns, sheet);

    const data: ValueRangeInput[] = [];
    const written: number[] = [];
    for (const write of writes) {
      if (drifted.has(write.rowNumber)) continue;
      written.push(write.rowNumber);
      for (const [column, value] of Object.entries(write.cells)) {
        const index = snapshot.columns[column];
        if (index === undefined || value === undefined) continue;
        data.push({
          range: `${sheet}!${columnLetter(index)}${write.rowNumber}`,
          values: [[value.slice(0, ERROR_MESSAGE_MAX_LENGTH)]],
        });
      }
    }
    await this.client.batchUpdateValues(data);

    return { written, drifted: [...drifted] };
  }

  private async findDrifted(
    snapshot: SheetSnapshot,
    writes: RowWrite[],
    keyColumns: string[],
    sheet: string,
  ): Promise<Set<number>> {
    const drifted = new Set<number>();
    const columns = keyColumns.filter((column) => column in snapshot.columns);
    if (!columns.length) return drifted;

    const rowNumbers = writes.map((write) => write.rowNumber);
    const first = Math.min(...rowNumbers);
    const last = Math.max(...rowNumbers);
    const ranges = columns.map((column) => {
      const letter = columnLetter(snapshot.columns[column]);
      return `${sheet}!${letter}${first}:${letter}${last}`;
    });
    const current = await this.client.batchGet(ranges, 'FORMATTED_VALUE');

    const rows = new Map(snapshot.rows.map((row) => [row.rowNumber, row]));
    for (const rowNumber of rowNumbers) {
      const before = rows.get(rowNumber);
      const moved = columns.some((column, index) => {
        const now = text(current[index]?.[rowNumber - first]?.[0]).trim();
        return now !== (before?.cells[column]?.formatted ?? '').trim();
      });
      if (moved) drifted.add(rowNumber);
    }
    return drifted;
  }
}
