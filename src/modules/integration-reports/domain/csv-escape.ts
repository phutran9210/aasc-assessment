export const CSV_BOM = '﻿';

// A spreadsheet evaluates a cell starting with one of these; control characters in front of them
// are skipped by some importers, so a leading control character is treated the same way.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);
const FIRST_PRINTABLE = 0x20;
const NEEDS_QUOTES = /[",\r\n]/;

/** Prefixes a text cell with an apostrophe when a spreadsheet could run it as a formula. */
export function neutralizeCell(value: string): string {
  if (!value) return value;
  const risky = FORMULA_TRIGGERS.has(value[0]) || value.charCodeAt(0) < FIRST_PRINTABLE;
  return risky ? `'${value}` : value;
}

/** One RFC 4180 field; strings are neutralized first, numbers are written as they are. */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = neutralizeCell(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvLine(cells: ReadonlyArray<string | number | null>): string {
  return `${cells.map(csvField).join(',')}\r\n`;
}
