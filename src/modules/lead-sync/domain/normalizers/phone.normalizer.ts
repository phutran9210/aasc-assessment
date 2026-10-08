import type { LeadSyncCountry } from '@config/index.js';

import { COUNTRY_PHONE_RULES } from '../../constants/index.js';
import { LEAD_SYNC_MESSAGES } from '../../messages/index.js';
import type { CellValue, NormalizeResult } from '../../types/index.js';

const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

/**
 * Turns a phone number as typed into E.164 (`+84901234567`). Reads the displayed text: a cell
 * Sheets understood as a number has lost its leading zero in the stored value, and may have lost
 * it on screen too, so a bare national number gets the calling code of `country`.
 */
export function normalizePhone(cell: CellValue, country: LeadSyncCountry): NormalizeResult<string> {
  const text = cell.formatted.trim();
  if (!text) return { ok: true, value: undefined };

  const compact = text.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.PHONE };

  const { code, nationalLength } = COUNTRY_PHONE_RULES[country];
  let digits: string;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else if (compact.startsWith('0')) digits = code + compact.slice(1);
  else if (compact.startsWith(code) && compact.length === code.length + nationalLength) {
    digits = compact;
  } else digits = code + compact;

  if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) {
    return { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.PHONE };
  }
  return { ok: true, value: `+${digits}` };
}
