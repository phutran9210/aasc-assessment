import { LEAD_SYNC_MESSAGES } from '@modules/lead-sync/messages/index.js';
import type { CellValue, NormalizeResult } from '@modules/lead-sync/types/index.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(cell: CellValue): NormalizeResult<string> {
  const value = cell.formatted.trim().toLowerCase();
  if (!value) return { ok: true, value: undefined };
  if (value.length > EMAIL_MAX_LENGTH || !EMAIL.test(value)) {
    return { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.EMAIL };
  }
  return { ok: true, value };
}
