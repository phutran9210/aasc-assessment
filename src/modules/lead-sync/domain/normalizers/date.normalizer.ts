import { LEAD_SYNC_MESSAGES } from '../../messages/index.js';
import type { CellValue, NormalizeResult } from '../../types/index.js';

const INVALID = { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.DATE } as const;

/** Google Sheets counts days from 30/12/1899; the fraction of a serial number is the time. */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/;

/**
 * Turns a date cell into `YYYY-MM-DD`, the form Bitrix24 takes for a date field. A real date
 * cell is read from its serial number, so the way the Sheet displays it (`Oct 8, 2026`) does not
 * matter. Text is read day first, as Vietnamese users type it: `08/10/2026` is 8 October.
 * The time of day is dropped.
 */
export function normalizeDate(cell: CellValue): NormalizeResult<string> {
  if (typeof cell.raw === 'number') {
    if (!Number.isFinite(cell.raw) || cell.raw < 1) return INVALID;
    const date = new Date(SHEETS_EPOCH_MS + Math.floor(cell.raw) * DAY_MS);
    return { ok: true, value: date.toISOString().slice(0, 10) };
  }
  if (typeof cell.raw === 'boolean') return INVALID;

  const text = cell.formatted.trim();
  if (!text) return { ok: true, value: undefined };

  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) return toIsoDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const iso = ISO.exec(text);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return INVALID;
}

/** Rejects dates the calendar does not have (31/02), which `Date` would roll over silently. */
function toIsoDate(year: number, month: number, day: number): NormalizeResult<string> {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { ok: true, value: date.toISOString().slice(0, 10) } : INVALID;
}
