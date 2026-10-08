import { Temporal } from '@common/utils/index.js';

import { LEAD_SYNC_MESSAGES } from '../../messages/index.js';
import type { CellValue, NormalizeResult } from '../../types/index.js';

const INVALID = { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.DATETIME } as const;

/** Google Sheets counts days from 30/12/1899; the fraction of a serial number is the time. */
const SHEETS_EPOCH = Temporal.PlainDateTime.from('1899-12-30T00:00:00');
const SECONDS_PER_DAY = 86_400;

const TIME = String.raw`(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?`;
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})${TIME}$`);
const ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}(Z|[+-]\d{2}:?\d{2})?$`);

/**
 * Turns a date-and-time cell into `YYYY-MM-DDTHH:mm:ss+HH:MM`, the form Bitrix24 takes for a
 * datetime field. A value without an offset is wall-clock time in `timezone` (a Sheet has no
 * notion of offsets); one that carries its own offset keeps it. Text is read day first.
 */
export function normalizeDateTime(cell: CellValue, timezone: string): NormalizeResult<string> {
  if (typeof cell.raw === 'number') {
    if (!Number.isFinite(cell.raw) || cell.raw < 1) return INVALID;
    const seconds = Math.round(cell.raw * SECONDS_PER_DAY);
    return inZone(SHEETS_EPOCH.add({ seconds }), timezone);
  }
  if (typeof cell.raw === 'boolean') return INVALID;

  const text = cell.formatted.trim();
  if (!text) return { ok: true, value: undefined };

  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) {
    const [, day, month, year, hour, minute, second] = dayFirst;
    return build([year, month, day, hour, minute, second], undefined, timezone);
  }
  const iso = ISO.exec(text);
  if (iso) {
    const [, year, month, day, hour, minute, second, offset] = iso;
    return build([year, month, day, hour, minute, second], offset, timezone);
  }
  return INVALID;
}

function build(
  parts: (string | undefined)[],
  offset: string | undefined,
  timezone: string,
): NormalizeResult<string> {
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts.map((part) =>
    part === undefined ? undefined : Number(part),
  );
  let local: Temporal.PlainDateTime;
  try {
    // `reject` refuses 31/02 and 25:00 instead of rolling them over.
    local = Temporal.PlainDateTime.from(
      { year, month, day, hour, minute, second },
      { overflow: 'reject' },
    );
  } catch {
    return INVALID;
  }
  if (offset === undefined) return inZone(local, timezone);

  const normalized = offset === 'Z' ? '+00:00' : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  return { ok: true, value: `${local.toString({ smallestUnit: 'second' })}${normalized}` };
}

function inZone(local: Temporal.PlainDateTime, timezone: string): NormalizeResult<string> {
  const zoned = local.toZonedDateTime(timezone);
  return {
    ok: true,
    value: zoned.toString({ smallestUnit: 'second', timeZoneName: 'never' }),
  };
}
