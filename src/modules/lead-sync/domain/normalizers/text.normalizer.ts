import type { CellValue, NormalizeResult } from '../../types/index.js';

/** Trimmed text with every run of whitespace (including line breaks) reduced to one space. */
export function cleanText(cell: CellValue): string {
  return cell.formatted.replace(/\s+/g, ' ').trim();
}

export function normalizeText(cell: CellValue): NormalizeResult<string> {
  return { ok: true, value: cleanText(cell) || undefined };
}
