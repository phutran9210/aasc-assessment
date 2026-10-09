import { BadRequestException } from '@nestjs/common';

export type ImportFormat = 'csv' | 'json';

export type ImportSchema = {
  name: string;
  required: readonly string[];
  optional: readonly string[];
};

export type CsvRow = {
  /** 1-based position among data rows; blank lines are not counted. */
  rowNumber: number;
  cells: string[] | null;
  errorCode?: 'ROW_MALFORMED' | 'ROW_COLUMN_COUNT_MISMATCH';
};

export type ImportRecord = {
  rowNumber: number;
  values: Record<string, string> | null;
  errorCode?: 'ROW_MALFORMED' | 'ROW_COLUMN_COUNT_MISMATCH';
};

export const LEAD_IMPORT_SCHEMA: ImportSchema = {
  name: 'historical leads',
  required: ['advertiser_id', 'source_record_id', 'occurred_at', 'full_name'],
  optional: [
    'email',
    'phone',
    'city',
    'campaign_id',
    'campaign_name',
    'ad_id',
    'ad_name',
    'form_id',
    'form_name',
    'ttclid',
    'interests',
    'crm_feedback_allowed',
  ],
} as const;

export const COST_IMPORT_SCHEMA: ImportSchema = {
  name: 'campaign costs',
  required: ['advertiser_id', 'campaign_id', 'date', 'currency', 'spend'],
  optional: ['impressions', 'clicks'],
} as const;

const BOM = '﻿';

/**
 * RFC 4180 reader that never gives up on a whole file: a row with the wrong number of columns or
 * an unterminated quote is returned as a row-level error so the rest can still be imported.
 */
export function parseCsv(input: string): { header: string[]; rows: CsvRow[] } {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  let header: string[] | null = null;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoted = false;

  const endRecord = (malformed: boolean) => {
    cells.push(field);
    const blank = cells.length === 1 && cells[0] === '' && !quoted;
    const record = cells;
    cells = [];
    field = '';
    quoted = false;
    if (blank && !malformed) return;
    if (!header) {
      header = malformed ? [] : record;
      return;
    }
    const rowNumber = rows.length + 1;
    if (malformed) rows.push({ rowNumber, cells: null, errorCode: 'ROW_MALFORMED' });
    else if (record.length !== header.length) {
      rows.push({ rowNumber, cells: null, errorCode: 'ROW_COLUMN_COUNT_MISMATCH' });
    } else rows.push({ rowNumber, cells: record });
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else inQuotes = false;
    } else if (char === '"' && field === '') {
      inQuotes = true;
      quoted = true;
    } else if (char === ',') {
      cells.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRecord(false);
    } else field += char;
  }
  if (inQuotes) endRecord(true);
  else if (field !== '' || cells.length > 0) endRecord(false);

  return { header: header ?? [], rows };
}

/** Decodes an uploaded file and maps every row to the explicit schema of its import type. */
export function readImportRecords(
  format: ImportFormat,
  content: Buffer,
  schema: ImportSchema,
): { records: ImportRecord[] } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new BadRequestException('Import file must be UTF-8 encoded');
  }
  return format === 'json' ? readJson(text, schema) : readCsv(text, schema);
}

function readCsv(text: string, schema: ImportSchema): { records: ImportRecord[] } {
  const { header, rows } = parseCsv(text);
  const names = header.map((name) => name.trim());
  if (!names.length || names.every((name) => name === '')) {
    throw new BadRequestException(`The ${schema.name} file has no header row`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) throw new BadRequestException(`Duplicate column "${name}"`);
    seen.add(key);
  }
  const allowed = new Set([...schema.required, ...schema.optional]);
  const unknown = names.find((name) => !allowed.has(name));
  if (unknown !== undefined) throw new BadRequestException(`Unknown column "${unknown}"`);
  const missing = schema.required.find((name) => !names.includes(name));
  if (missing) throw new BadRequestException(`Missing required column "${missing}"`);

  return {
    records: rows.map((row) =>
      row.cells
        ? {
            rowNumber: row.rowNumber,
            values: Object.fromEntries(
              names.map((name, index) => [name, (row.cells as string[])[index]]),
            ),
          }
        : { rowNumber: row.rowNumber, values: null, errorCode: row.errorCode },
    ),
  };
}

function readJson(text: string, schema: ImportSchema): { records: ImportRecord[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch {
    throw new BadRequestException('Import file is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new BadRequestException('JSON import must be a root array');

  const allowed = [...schema.required, ...schema.optional];
  return {
    records: parsed.map((element: unknown, index): ImportRecord => {
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        return { rowNumber: index + 1, values: null, errorCode: 'ROW_MALFORMED' };
      }
      const source = element as Record<string, unknown>;
      const values: Record<string, string> = {};
      for (const name of allowed) {
        if (!Object.hasOwn(source, name)) continue;
        const value = source[name];
        // Only scalars are data; nested objects and arrays are not part of the schema.
        if (typeof value === 'string') values[name] = value;
        else if (typeof value === 'number' || typeof value === 'boolean') {
          values[name] = String(value);
        }
      }
      return { rowNumber: index + 1, values };
    }),
  };
}
