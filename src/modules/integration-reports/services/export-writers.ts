import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';

import ExcelJS from 'exceljs';

import { CSV_BOM, csvLine, neutralizeCell } from '../domain/csv-escape.js';
import { EXPORT_COLUMNS } from '../domain/export-row.js';
import type { ExportRow } from '../domain/export-row.js';
import type { ExportFormat } from '../types/report.types.js';

export type ExportWriter = {
  write(rows: readonly ExportRow[]): Promise<void>;
  /** Flushes and closes the file; the export is only usable after this resolves. */
  close(): Promise<void>;
  /** Releases the file handle after a failure; the partial file is discarded by the caller. */
  abort(): Promise<void>;
};

const E164 = /^\+[1-9]\d{7,14}$/;

export function createExportWriter(format: ExportFormat, path: string): ExportWriter {
  if (format === 'csv') return new CsvWriter(path);
  if (format === 'json') return new JsonWriter(path);
  return new XlsxWriter(path);
}

abstract class TextWriter implements ExportWriter {
  protected readonly stream: WriteStream;
  private failure?: Error;

  constructor(path: string) {
    this.stream = createWriteStream(path, { encoding: 'utf8', flags: 'wx' });
    this.stream.on('error', (error) => {
      this.failure = error;
    });
  }

  abstract write(rows: readonly ExportRow[]): Promise<void>;

  /** Writes honoring backpressure so a large export never buffers in memory. */
  protected async emit(chunk: string): Promise<void> {
    if (this.failure) throw this.failure;
    if (!this.stream.write(chunk)) await once(this.stream, 'drain');
  }

  async close(): Promise<void> {
    if (this.failure) throw this.failure;
    this.stream.end();
    await once(this.stream, 'finish');
  }

  async abort(): Promise<void> {
    if (this.stream.destroyed) return;
    this.stream.destroy();
    await once(this.stream, 'close').catch(() => undefined);
  }
}

class CsvWriter extends TextWriter {
  private started = false;

  async write(rows: readonly ExportRow[]): Promise<void> {
    await this.start();
    if (!rows.length) return;
    await this.emit(
      rows.map((row) => csvLine(EXPORT_COLUMNS.map((column) => row[column.key]))).join(''),
    );
  }

  override async close(): Promise<void> {
    await this.start();
    await super.close();
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.emit(CSV_BOM + csvLine(EXPORT_COLUMNS.map((column) => column.header)));
  }
}

class JsonWriter extends TextWriter {
  private count = 0;

  async write(rows: readonly ExportRow[]): Promise<void> {
    for (const row of rows) {
      await this.emit(`${this.count === 0 ? '[' : ','}\n${JSON.stringify(row)}`);
      this.count += 1;
    }
  }

  override async close(): Promise<void> {
    await this.emit(this.count === 0 ? '[]\n' : '\n]\n');
    await super.close();
  }
}

/** Streams rows to disk; identifiers, phones and money are string cells formatted as text. */
class XlsxWriter implements ExportWriter {
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheet: ExcelJS.Worksheet;

  constructor(path: string) {
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: path,
      useStyles: true,
      useSharedStrings: false,
    });
    this.sheet = this.workbook.addWorksheet('leads');
    this.sheet.columns = EXPORT_COLUMNS.map((column) => ({
      header: column.header,
      key: column.key,
      width: 24,
      style: column.type === 'text' ? { numFmt: '@' } : {},
    }));
    this.sheet.getRow(1).commit();
  }

  write(rows: readonly ExportRow[]): Promise<void> {
    for (const row of rows) {
      this.sheet
        .addRow(
          EXPORT_COLUMNS.map((column) => {
            const value = row[column.key];
            if (typeof value !== 'string') return value;
            // A validated E.164 number cannot be a formula, so its leading plus is kept as is.
            return column.key === 'phone' && E164.test(value) ? value : neutralizeCell(value);
          }),
        )
        .commit();
    }
    return Promise.resolve();
  }

  async close(): Promise<void> {
    this.sheet.commit();
    await this.workbook.commit();
  }

  async abort(): Promise<void> {
    await this.workbook.commit().catch(() => undefined);
  }
}
