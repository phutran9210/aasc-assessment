import { BadRequestException } from '@nestjs/common';

import { Temporal } from '@common/utils/temporal.util.js';
import type {
  PeriodDay,
  PeriodKind,
  PeriodQuery,
  ResolvedPeriod,
} from '../types/analytics.types.js';

export const DEFAULT_REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_DAILY_PERIOD_DAYS = 366;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_RANGE = /^([1-9]\d{0,2})d$/;
const ISO_OPTIONS = { fractionalSecondDigits: 3 } as const;

/**
 * Resolves the half-open reporting interval `[from,to)`. Daily periods must align with calendar
 * days of the timezone because daily spend cannot be split by the hour.
 */
export function resolvePeriod(
  query: PeriodQuery,
  kind: PeriodKind,
  now: string | Temporal.Instant,
): ResolvedPeriod {
  const timezone = resolveTimezone(query.timezone);
  const current = Temporal.Instant.from(now).toZonedDateTimeISO(timezone);
  const hasBounds = query.from !== undefined || query.to !== undefined;
  if (query.dateRange !== undefined && hasBounds) {
    throw new BadRequestException('date_range cannot be combined with from/to');
  }

  let from: Temporal.ZonedDateTime;
  let to: Temporal.ZonedDateTime;
  if (hasBounds) {
    if (query.from === undefined || query.to === undefined) {
      throw new BadRequestException('from and to must be provided together');
    }
    from = parseBound(query.from, timezone);
    to = parseBound(query.to, timezone);
  } else {
    const days = parseDateRange(query.dateRange);
    to = kind === 'daily' ? current.startOfDay() : current;
    from = to.subtract({ days });
  }
  if (Temporal.ZonedDateTime.compare(from, to) >= 0) {
    throw new BadRequestException('from must be earlier than to');
  }

  const base = {
    from: from.toInstant().toString(ISO_OPTIONS),
    to: to.toInstant().toString(ISO_OPTIONS),
    timezone,
    kind,
  };
  if (kind === 'cohort') return { ...base, fromDate: null, toDate: null, days: [] };

  if (!from.equals(from.startOfDay()) || !to.equals(to.startOfDay())) {
    throw new BadRequestException('Daily periods must align with day boundaries of the timezone');
  }
  const fromDate = from.toPlainDate();
  const toDate = to.toPlainDate();
  if (fromDate.until(toDate, { largestUnit: 'days' }).days > MAX_DAILY_PERIOD_DAYS) {
    throw new BadRequestException(`Daily periods cover at most ${MAX_DAILY_PERIOD_DAYS} days`);
  }
  return {
    ...base,
    fromDate: fromDate.toString(),
    toDate: toDate.toString(),
    days: enumerateDays(fromDate, toDate, timezone),
  };
}

function resolveTimezone(timezone: string | undefined): string {
  if (timezone === undefined) return DEFAULT_REPORT_TIMEZONE;
  try {
    return Temporal.Now.zonedDateTimeISO(timezone).timeZoneId;
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }
}

function parseDateRange(dateRange: string | undefined): number {
  if (dateRange === undefined) return DEFAULT_PERIOD_DAYS;
  const days = Number(DATE_RANGE.exec(dateRange)?.[1]);
  if (!Number.isInteger(days) || days > MAX_DAILY_PERIOD_DAYS) {
    throw new BadRequestException('date_range must look like 30d');
  }
  return days;
}

function parseBound(value: string, timezone: string): Temporal.ZonedDateTime {
  try {
    if (DATE_ONLY.test(value)) {
      return Temporal.PlainDate.from(value, { overflow: 'reject' }).toZonedDateTime(timezone);
    }
    return Temporal.Instant.from(value).toZonedDateTimeISO(timezone);
  } catch {
    throw new BadRequestException(
      'from/to must be ISO 8601 dates or instants with an explicit offset',
    );
  }
}

function enumerateDays(
  fromDate: Temporal.PlainDate,
  toDate: Temporal.PlainDate,
  timezone: string,
): PeriodDay[] {
  const days: PeriodDay[] = [];
  for (
    let date = fromDate;
    Temporal.PlainDate.compare(date, toDate) < 0;
    date = date.add({ days: 1 })
  ) {
    const start = date.toZonedDateTime(timezone);
    const end = date.add({ days: 1 }).toZonedDateTime(timezone);
    days.push({
      date: date.toString(),
      start: start.toInstant().toString(ISO_OPTIONS),
      end: end.toInstant().toString(ISO_OPTIONS),
      hours: start.until(end, { largestUnit: 'hours' }).total('hours'),
    });
  }
  return days;
}
