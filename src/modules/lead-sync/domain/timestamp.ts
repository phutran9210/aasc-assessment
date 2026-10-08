import { Temporal } from '@common/utils/index.js';

/** Current wall-clock time in `timezone`, e.g. `2026-10-08 09:15:00`, for the Sheet. */
export function formatTimestamp(timezone: string): string {
  return Temporal.Now.zonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'second' })
    .replace('T', ' ');
}
