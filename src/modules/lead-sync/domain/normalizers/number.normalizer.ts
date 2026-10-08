import { LEAD_SYNC_MESSAGES } from '../../messages/index.js';
import type { CellValue, NormalizeResult } from '../../types/index.js';

const INVALID = { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.NUMBER } as const;

// Vietnamese shorthand typed into a text cell: 15tr, 1,5 triệu, 500k, 2 tỷ.
const UNITS: [RegExp, number][] = [
  [/(tỷ|ty)$/, 1e9],
  [/(triệu|trieu|tr)$/, 1e6],
  [/(nghìn|nghin|ngàn|ngan|k)$/, 1e3],
];

/**
 * A real number cell is taken from its stored value, so currency formatting (`1.500.000 ₫`)
 * cannot distort it. Text is parsed with the Vietnamese convention: `.` and `,` followed by
 * exactly three digits are thousands separators.
 */
export function normalizeNumber(cell: CellValue): NormalizeResult<number> {
  if (typeof cell.raw === 'number') {
    return Number.isFinite(cell.raw) && cell.raw >= 0 ? { ok: true, value: cell.raw } : INVALID;
  }
  if (typeof cell.raw === 'boolean') return INVALID;

  let text = cell.formatted
    .trim()
    .toLowerCase()
    .replace(/vnđ|vnd|[\s₫đ$€]/g, '');
  if (!text) return { ok: true, value: undefined };

  let multiplier = 1;
  for (const [suffix, factor] of UNITS) {
    if (suffix.test(text)) {
      text = text.replace(suffix, '');
      multiplier = factor;
      break;
    }
  }

  let value: number;
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) value = Number(text.replace(/[.,]/g, ''));
  else if (/^\d+([.,]\d+)?$/.test(text)) value = Number(text.replace(',', '.'));
  else return INVALID;

  return { ok: true, value: Math.round(value * multiplier * 100) / 100 };
}
