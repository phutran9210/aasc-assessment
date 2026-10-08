import type { LeadSyncCountry } from '@config/index.js';

import { SHEET_ERROR_VALUES } from '../constants/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type {
  CellValue,
  LeadFieldValue,
  LeadMapping,
  MappingField,
  NormalizeResult,
  SheetRow,
  TransformedRow,
} from '../types/index.js';
import {
  normalizeEmail,
  normalizeLookup,
  normalizeNumber,
  normalizePhone,
  normalizeText,
} from './normalizers/index.js';
import { hashRow } from './sync-hash.js';

export type TransformContext = {
  mapping: LeadMapping;
  mappingHash: string;
  defaultCountry: LeadSyncCountry;
};

const EMPTY_CELL: CellValue = { formatted: '', raw: null };
const { VALIDATION } = LEAD_SYNC_MESSAGES;

/**
 * Pure function: one Sheet row + the mapping → normalized lead fields, dedupe keys and the sync
 * hash, or the list of validation errors. No I/O, so the same row always gives the same result.
 */
export function transformRow(row: SheetRow, context: TransformContext): TransformedRow {
  const { mapping, mappingHash, defaultCountry } = context;
  const { rowNumber } = row;
  const cellOf = (column: string): CellValue => row.cells[column] ?? EMPTY_CELL;

  if (mapping.fields.every((field) => cellOf(field.column).formatted.trim() === '')) {
    return { kind: 'empty', rowNumber };
  }

  const errors: string[] = [];
  const fields: Record<string, LeadFieldValue> = { ...mapping.defaults };
  const keys: { email?: string; phone?: string } = {};

  for (const field of mapping.fields) {
    const result = normalizeCell(cellOf(field.column), field, defaultCountry);
    if (!result.ok) {
      errors.push(VALIDATION.COLUMN(field.column, result.error));
    } else if (result.value === undefined) {
      if (field.required) errors.push(VALIDATION.COLUMN(field.column, VALIDATION.REQUIRED));
    } else if (field.field === 'email' || field.field === 'phone') {
      keys[field.field] = String(result.value);
    } else {
      fields[field.field] = result.value;
    }
  }

  const { dedupe } = mapping;
  if (dedupe.requireAtLeastOne && !dedupe.keys.some((key) => keys[key] !== undefined)) {
    errors.push(VALIDATION.DEDUPE_KEY_REQUIRED);
  }

  if (errors.length) {
    // Hash of what the user typed: the row is skipped until one of these cells changes.
    const typed = Object.fromEntries(
      mapping.fields.map((field) => [field.column, cellOf(field.column).formatted.trim()]),
    );
    return { kind: 'invalid', rowNumber, errors, hash: hashRow(typed, mappingHash) };
  }

  const title = renderTitle(mapping.titleTemplate, cellOf);
  if (title && fields.title === undefined) fields.title = title;

  return {
    kind: 'valid',
    rowNumber,
    fields,
    email: keys.email,
    phone: keys.phone,
    hash: hashRow({ fields, email: keys.email, phone: keys.phone }, mappingHash),
  };
}

function normalizeCell(
  cell: CellValue,
  field: MappingField,
  country: LeadSyncCountry,
): NormalizeResult<LeadFieldValue> {
  const shown = cell.formatted.trim();
  if (SHEET_ERROR_VALUES.includes(shown)) {
    return { ok: false, error: VALIDATION.FORMULA_ERROR(shown) };
  }
  switch (field.type) {
    case 'email':
      return normalizeEmail(cell);
    case 'phone':
      return normalizePhone(cell, country);
    case 'number':
      return normalizeNumber(cell);
    case 'enum':
    case 'user':
      return normalizeLookup(cell, field);
    default:
      return normalizeText(cell);
  }
}

/** Fills `{Column}` placeholders and drops separators left dangling by an empty column. */
function renderTitle(
  template: string | undefined,
  cellOf: (column: string) => CellValue,
): string | undefined {
  if (!template) return undefined;
  const text = template
    .replace(/\{([^}]+)\}/g, (_match, column: string) => cellOf(column.trim()).formatted.trim())
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|,]+|[\s\-–|,]+$/g, '');
  return text || undefined;
}
