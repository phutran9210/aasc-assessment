import type { LeadSyncCountry } from '@config/index.js';

import { COUNTRY_PHONE_RULES } from '@modules/lead-sync/constants/index.js';
import { LEAD_SYNC_MESSAGES } from '@modules/lead-sync/messages/index.js';
import type { CellValue, NormalizeResult } from '@modules/lead-sync/types/index.js';

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

/** A national number shorter than this is not searched on its own: it would match too widely. */
const MIN_NATIONAL_DIGITS = 7;

/**
 * Other spellings of an E.164 number that a lead typed by hand may carry: without the plus
 * (`84901234567`), with the `00` prefix, and the national form with and without the trunk prefix
 * (`0901234567`, `901234567`). Bitrix24 compares the digits as stored, so a search for
 * `+84901234567` alone misses a lead saved as `0901 234 567` and a duplicate would be created.
 *
 * Calling codes are prefix-free, so a number that starts with a known code belongs to that
 * country whatever its length: a landline (`+842838221234`) gets its national form too.
 */
export function phoneSearchVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '');
  const variants = new Set([digits, `00${digits}`]);
  for (const { code, trunk } of Object.values(COUNTRY_PHONE_RULES)) {
    if (!digits.startsWith(code)) continue;
    const national = digits.slice(code.length);
    if (national.length < MIN_NATIONAL_DIGITS) continue;
    variants.add(trunk + national);
    variants.add(national);
  }
  variants.delete(e164);
  return [...variants];
}
