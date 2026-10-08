import type { DedupeKey, FieldType } from '../constants/index.js';

/** One entry of `mapping.json`: a Sheet column, the lead field it feeds and how to read it. */
export type MappingField = {
  column: string;
  field: string;
  type: FieldType;
  required: boolean;
  /** enum / user: display label → Bitrix24 code. */
  values?: Record<string, string | number>;
  default?: string | number;
  onUnknown: 'error' | 'default';
};

export type LeadMapping = {
  version: 1;
  sheet: { headerRow: number };
  /** `{Column name}` placeholders, rendered into the lead `title`. */
  titleTemplate?: string;
  /** Lead fields sent with every row unless the row provides its own value. */
  defaults: Record<string, string | number>;
  dedupe: { keys: DedupeKey[]; requireAtLeastOne: boolean };
  fields: MappingField[];
};

/** A cell read twice: as displayed (`formatted`) and as stored (`raw`). */
export type CellValue = { formatted: string; raw: string | number | boolean | null };

/** What the technical columns of a row say about its last sync. */
export type RowState = { leadId: string; status: string; error: string; hash: string };

export type SheetRow = {
  /** 1-based row number in the worksheet. */
  rowNumber: number;
  /** Header text → cell. */
  cells: Record<string, CellValue>;
  state: RowState;
};

export type LeadFieldValue = string | number;

export type ValidRow = {
  kind: 'valid';
  rowNumber: number;
  /** Normalized lead fields, without email and phone. */
  fields: Record<string, LeadFieldValue>;
  email?: string;
  phone?: string;
  hash: string;
};

export type InvalidRow = { kind: 'invalid'; rowNumber: number; errors: string[]; hash: string };

export type EmptyRow = { kind: 'empty'; rowNumber: number };

export type TransformedRow = ValidRow | InvalidRow | EmptyRow;

/** `value: undefined` means the cell is blank. */
export type NormalizeResult<T> = { ok: true; value: T | undefined } | { ok: false; error: string };
