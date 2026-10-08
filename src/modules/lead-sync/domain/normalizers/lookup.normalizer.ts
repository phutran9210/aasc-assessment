import { LEAD_SYNC_MESSAGES } from '../../messages/index.js';
import type { CellValue, MappingField, NormalizeResult } from '../../types/index.js';
import { cleanText } from './text.normalizer.js';

const fold = (text: string): string => text.trim().toLocaleLowerCase('vi');

/**
 * `enum` and `user`: looks the displayed label up in the `values` table of the mapping.
 * An unknown `user` is never an error, the lead simply keeps `defaults.assignedById`.
 */
export function normalizeLookup(
  cell: CellValue,
  field: MappingField,
): NormalizeResult<string | number> {
  const label = cleanText(cell);
  if (!label) return { ok: true, value: undefined };

  const values = field.values ?? {};
  const hit = Object.entries(values).find(([key]) => fold(key) === fold(label));
  if (hit) return { ok: true, value: hit[1] };

  if (field.type === 'user' || field.onUnknown === 'default') {
    return { ok: true, value: field.default };
  }
  return { ok: false, error: LEAD_SYNC_MESSAGES.VALIDATION.ENUM(label, Object.keys(values)) };
}
