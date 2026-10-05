import { Temporal } from 'temporal-polyfill';

// Single source of truth for date/time. Node does not ship `Temporal` unflagged yet, so the
// spec-compliant polyfill is re-exported here; switching to the native global later only
// touches this file.
export { Temporal };

/** Current moment as ISO 8601 in UTC with millisecond precision, e.g. `2026-10-04T15:00:00.000Z`. */
export function nowIso(): string {
  return Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
}

/** Milliseconds elapsed between `start` and now. */
export function elapsedMs(start: Temporal.Instant): number {
  return Temporal.Now.instant().epochMilliseconds - start.epochMilliseconds;
}

/** Current moment as epoch milliseconds, for deadlines, leases and elapsed-time arithmetic. */
export function nowMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

/** Current moment as a `Date`: TypeORM `datetime` columns only accept `Date` values. */
export function nowDate(): Date {
  return new Date(nowMs());
}
