import type {
  DedupeKey,
  FieldType,
  LeadSyncRunStatus,
  LeadSyncTrigger,
  RunItemAction,
} from '../constants/index.js';

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
  /** First value of the cell: the dedupe key. */
  email?: string;
  phone?: string;
  /** Further values of the same cell, added to the lead next to the first one. */
  extraEmails?: string[];
  extraPhones?: string[];
  hash: string;
};

export type InvalidRow = { kind: 'invalid'; rowNumber: number; errors: string[]; hash: string };

export type EmptyRow = { kind: 'empty'; rowNumber: number };

export type TransformedRow = ValidRow | InvalidRow | EmptyRow;

/** `value: undefined` means the cell is blank. */
export type NormalizeResult<T> = { ok: true; value: T | undefined } | { ok: false; error: string };

/** Why a row was not synced, and what to write back about it. */
export type RowFailure = {
  rowNumber: number;
  code: string;
  message: string;
  /** Written to `Sync Hash` so the row is skipped until it changes. Absent for retryable errors. */
  hashCell?: string;
  /** The Sheet already shows exactly this error: count it, but do not write it again. */
  unchanged?: boolean;
  /** The row moved in the Sheet: writing to its old row number would hit another lead. */
  skipSheet?: boolean;
};

/** A valid row that has to be sent; `leadId` is the lead it is already linked to, if any. */
export type PendingRow = { row: ValidRow; leadId?: number };

/** One `crm.duplicate.findbycomm` command: exactly one value, so the key identifies the row. */
export type DuplicateQuery = { key: string; type: 'EMAIL' | 'PHONE'; value: string };

/** Lead IDs found for one row, ascending. */
export type DuplicateMatches = { byEmail: number[]; byPhone: number[] };

export type PlannedOp = {
  row: ValidRow;
  action: 'create' | 'update';
  leadId?: number;
  /** Other leads that matched the same row; only logged. */
  otherMatches: number[];
};

/** `crm.item.*` multifield entry: { id, typeId: 'PHONE' | 'EMAIL', valueType, value }. */
export type BitrixMultifield = {
  id?: number | string;
  typeId?: string;
  valueType?: string;
  value?: string;
};

export type BitrixLeadItem = { id: number | string; fm?: unknown; [field: string]: unknown };

export type LeadWriteOp = PlannedOp & { current?: BitrixLeadItem };

export type LeadWriteResult =
  { ok: true; leadId: number } | { ok: false; code: string; message: string };

export type RunCounters = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

/** One line of the run log. No email, phone or customer name: row number and Lead ID suffice. */
export type RunItemInput = {
  rowNumber: number;
  action: RunItemAction;
  leadId?: number;
  errorCode?: string;
  errorMessage?: string;
  attempts?: number;
};

export type RunResponse = RunCounters & {
  id: string;
  trigger: LeadSyncTrigger;
  status: LeadSyncRunStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  stopReason: string | null;
};

export type RunItemResponse = {
  rowNumber: number;
  action: RunItemAction;
  leadId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
};

export type RunDetailResponse = RunResponse & { items: RunItemResponse[] };

export type ConnectionCheck = { ok: boolean; message: string | null };

export type LeadSyncStatusResponse = {
  configured: boolean;
  /** What is missing when `configured` is false. */
  reason: string | null;
  schedule: { cron: string | null; timezone: string; nextRunAt: string | null };
  lastRun: RunResponse | null;
  connections: { google: ConnectionCheck; bitrix: ConnectionCheck };
};

export type MappingResponse = { path: string; mapping: LeadMapping };
