import { Temporal } from '@common/utils/temporal.util.js';
import type { CampaignCostRow } from '../types/analytics.types.js';

export type CostRowIssue = {
  field: keyof CampaignCostRow;
  code:
    | 'required'
    | 'invalid_date'
    | 'invalid_timezone'
    | 'invalid_currency'
    | 'invalid_amount'
    | 'invalid_count';
};

export type NormalizedCostRow = Required<Omit<CampaignCostRow, 'fetchedAt'>> & {
  fetchedAt?: Date;
};

// numeric(20,4): at most 16 integer digits and 4 decimals, plain notation, never negative.
const AMOUNT = /^\d{1,16}(\.\d{1,4})?$/;
// bigint counters stay below 2^63 with 18 digits.
const COUNT = /^\d{1,18}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates one external cost row without ever converting money or counters to a float. */
export function normalizeCostRow(
  row: CampaignCostRow,
): { ok: true; row: NormalizedCostRow } | { ok: false; issue: CostRowIssue } {
  const fail = (field: CostRowIssue['field'], code: CostRowIssue['code']) =>
    ({ ok: false, issue: { field, code } }) as const;

  const advertiserId = text(row.advertiserId);
  if (!advertiserId || advertiserId.length > 255) return fail('advertiserId', 'required');
  const campaignId = text(row.campaignId);
  if (!campaignId || campaignId.length > 255) return fail('campaignId', 'required');

  const reportDate = text(row.reportDate);
  if (!DATE.test(reportDate) || !isCalendarDate(reportDate)) {
    return fail('reportDate', 'invalid_date');
  }
  const reportingTimezone = text(row.reportingTimezone);
  if (!isTimezone(reportingTimezone)) return fail('reportingTimezone', 'invalid_timezone');

  const currency = text(row.currency).toUpperCase();
  if (!CURRENCY.test(currency)) return fail('currency', 'invalid_currency');
  const spend = text(row.spend);
  if (!AMOUNT.test(spend)) return fail('spend', 'invalid_amount');

  const impressions = count(row.impressions);
  if (impressions === undefined) return fail('impressions', 'invalid_count');
  const clicks = count(row.clicks);
  if (clicks === undefined) return fail('clicks', 'invalid_count');

  return {
    ok: true,
    row: {
      advertiserId,
      campaignId,
      reportDate,
      reportingTimezone,
      currency,
      spend,
      impressions,
      clicks,
      fetchedAt: row.fetchedAt,
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value);
  return COUNT.test(normalized) ? normalized : undefined;
}

function isCalendarDate(value: string): boolean {
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

function isTimezone(value: string): boolean {
  if (!value || value.length > 80) return false;
  try {
    Temporal.Now.zonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
