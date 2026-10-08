import type {
  SheetCell,
  SheetMeta,
  SheetStructureRequest,
  ValueRangeInput,
  ValueRender,
} from '@modules/google-sheets/index.js';

import { columnIndex } from '../../domain/a1.js';

const RANGE = /^'(?:[^']|'')*'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/;

/**
 * In-memory worksheet with the public surface of SheetsClient. `grid[0]` is the header row.
 * Counts the requests, so tests can assert how many calls a run makes.
 */
export class FakeSheetsClient {
  grid: SheetCell[][];
  calls = { read: 0, write: 0 };
  structureRequests: SheetStructureRequest[] = [];
  columnCount = 26;
  /** Runs before every batchGet: lets a test edit the sheet "while the sync is running". */
  beforeRead: (() => void) | undefined;
  /** Thrown once by the next batchUpdateValues. */
  failNextWrite: Error | undefined;

  constructor(headers: string[], rows: SheetCell[][]) {
    // Copies: writes must not reach the arrays a test passed in (often shared constants).
    this.grid = [[...headers], ...rows.map((row) => [...row])];
  }

  getSheetMeta(): Promise<SheetMeta> {
    this.calls.read += 1;
    return Promise.resolve({
      sheetId: 77,
      title: 'Leads',
      timeZone: 'Asia/Ho_Chi_Minh',
      rowCount: 1000,
      columnCount: this.columnCount,
    });
  }

  batchGet(ranges: string[], render: ValueRender): Promise<SheetCell[][][]> {
    this.calls.read += 1;
    this.beforeRead?.();
    return Promise.resolve(ranges.map((range) => this.read(range, render)));
  }

  batchUpdateValues(data: ValueRangeInput[]): Promise<void> {
    if (!data.length) return Promise.resolve();
    this.calls.write += 1;
    if (this.failNextWrite) {
      const error = this.failNextWrite;
      this.failNextWrite = undefined;
      return Promise.reject(error);
    }
    for (const { range, values } of data) {
      const { top, left } = this.bounds(range);
      values.forEach((row, rowOffset) => {
        row.forEach((value, columnOffset) => {
          this.write(top + rowOffset, left + columnOffset, value);
        });
      });
    }
    return Promise.resolve();
  }

  batchUpdate(requests: SheetStructureRequest[]): Promise<void> {
    if (!requests.length) return Promise.resolve();
    this.calls.write += 1;
    this.structureRequests.push(...requests);
    for (const request of requests) {
      this.columnCount += request.appendDimension?.length ?? 0;
    }
    return Promise.resolve();
  }

  /** Displayed text of one cell, by 1-based row number and header text. */
  cell(rowNumber: number, header: string): string {
    const column = this.grid[0].indexOf(header);
    if (column < 0) return '';
    return String(this.grid[rowNumber - 1]?.[column] ?? '');
  }

  setCell(rowNumber: number, header: string, value: SheetCell): void {
    this.write(rowNumber - 1, this.grid[0].indexOf(header), value);
  }

  private read(range: string, render: ValueRender): SheetCell[][] {
    const { top, left, bottom, right } = this.bounds(range);
    const rows: SheetCell[][] = [];
    for (let row = top; row <= Math.min(bottom, this.grid.length - 1); row++) {
      const cells = (this.grid[row] ?? []).slice(left, right + 1);
      rows.push(render === 'FORMATTED_VALUE' ? cells.map((cell) => String(cell ?? '')) : cells);
    }
    return rows;
  }

  private write(row: number, column: number, value: SheetCell): void {
    while (this.grid.length <= row) this.grid.push([]);
    const cells = this.grid[row];
    while (cells.length <= column) cells.push('');
    cells[column] = value;
  }

  private bounds(range: string): { top: number; left: number; bottom: number; right: number } {
    const match = RANGE.exec(range);
    if (!match) throw new Error(`FakeSheetsClient cannot parse range ${range}`);
    const [, startColumn, startRow, endColumn, endRow] = match;
    if (!startColumn) {
      return { top: 0, left: 0, bottom: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER };
    }
    const top = Number(startRow) - 1;
    const left = columnIndex(startColumn);
    return {
      top,
      left,
      bottom: endRow ? Number(endRow) - 1 : top,
      right: endColumn ? columnIndex(endColumn) : left,
    };
  }
}
