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
  normalizeDate,
  normalizeDateTime,
  normalizeNumber,
  normalizePhone,
  normalizeText,
} from './normalizers/index.js';
import { hashRow } from './sync-hash.js';

export type TransformContext = {
  mapping: LeadMapping;
  mappingHash: string;
  defaultCountry: LeadSyncCountry;
  /** Zone of date-and-time cells that carry no offset. Defaults to Vietnam time. */
  timezone?: string;
};

type Locale = { country: LeadSyncCountry; timezone: string };
const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const EMPTY_CELL: CellValue = { formatted: '', raw: null };
const { VALIDATION } = LEAD_SYNC_MESSAGES;

/**
 * Pure function: one Sheet row + the mapping → normalized lead fields, dedupe keys and the sync
 * hash, or the list of validation errors. No I/O, so the same row always gives the same result.
 */
export function transformRow(row: SheetRow, context: TransformContext): TransformedRow {
  const { mapping, mappingHash } = context;
  const locale: Locale = {
    country: context.defaultCountry,
    timezone: context.timezone ?? DEFAULT_TIMEZONE,
  };
  const { rowNumber } = row;
  const cellOf = (column: string): CellValue => row.cells[column] ?? EMPTY_CELL;

  if (mapping.fields.every((field) => cellOf(field.column).formatted.trim() === '')) {
    return { kind: 'empty', rowNumber };
  }

  const errors: string[] = [];
  const fields: Record<string, LeadFieldValue> = { ...mapping.defaults };
  const keys: { email?: string[]; phone?: string[] } = {};

  for (const field of mapping.fields) {
    const cell = cellOf(field.column);
    if (field.field === 'email' || field.field === 'phone') {
      const result = normalizeContacts(cell, field, locale);
      if (!result.ok) errors.push(VALIDATION.COLUMN(field.column, result.error));
      else if (result.value?.length) keys[field.field] = result.value;
      else if (field.required) {
        errors.push(VALIDATION.COLUMN(field.column, VALIDATION.REQUIRED));
      }
      continue;
    }
    const result = normalizeCell(cell, field, locale);
    if (!result.ok) {
      errors.push(VALIDATION.COLUMN(field.column, result.error));
    } else if (result.value === undefined) {
      if (field.required) errors.push(VALIDATION.COLUMN(field.column, VALIDATION.REQUIRED));
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

  const [email, ...extraEmails] = keys.email ?? [];
  const [phone, ...extraPhones] = keys.phone ?? [];
  // Extra values enter the hash only when there are some, so the hash of a row with one email
  // and one phone is what it was before several values per cell were supported.
  const extras = {
    ...(extraEmails.length ? { extraEmails } : {}),
    ...(extraPhones.length ? { extraPhones } : {}),
  };

  return {
    kind: 'valid',
    rowNumber,
    fields,
    email,
    phone,
    ...extras,
    hash: hashRow({ fields, email, phone, ...extras }, mappingHash),
  };
}

function normalizeCell(
  cell: CellValue,
  field: MappingField,
  locale: Locale,
): NormalizeResult<LeadFieldValue> {
  const shown = cell.formatted.trim();
  if (SHEET_ERROR_VALUES.includes(shown)) {
    return { ok: false, error: VALIDATION.FORMULA_ERROR(shown) };
  }
  switch (field.type) {
    case 'email':
      return normalizeEmail(cell);
    case 'phone':
      return normalizePhone(cell, locale.country);
    case 'number':
      return normalizeNumber(cell);
    case 'date':
      return normalizeDate(cell);
    case 'datetime':
      return normalizeDateTime(cell, locale.timezone);
    case 'enum':
    case 'user':
      return normalizeLookup(cell, field);
    default:
      return normalizeText(cell);
  }
}

/** Separators between several emails or phone numbers typed into one cell. */
const CONTACT_SEPARATOR = /[,;\n]+/;

/**
 * An email or phone cell may hold several values. Each one is normalized on its own; the result
 * keeps their order without repeats, the first being the dedupe key of the row.
 */
function normalizeContacts(
  cell: CellValue,
  field: MappingField,
  locale: Locale,
): NormalizeResult<string[]> {
  const parts =
    typeof cell.raw === 'string' && CONTACT_SEPARATOR.test(cell.formatted)
      ? cell.formatted.split(CONTACT_SEPARATOR).filter((part) => part.trim() !== '')
      : null;
  if (!parts || parts.length < 2) {
    const single = normalizeCell(cell, field, locale);
    if (!single.ok) return single;
    return { ok: true, value: single.value === undefined ? undefined : [String(single.value)] };
  }

  const values: string[] = [];
  for (const part of parts) {
    const result = normalizeCell({ formatted: part, raw: part }, field, locale);
    if (!result.ok) return { ok: false, error: VALIDATION.ONE_OF_MANY(part.trim(), result.error) };
    const value = result.value === undefined ? undefined : String(result.value);
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  return { ok: true, value: values };
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
