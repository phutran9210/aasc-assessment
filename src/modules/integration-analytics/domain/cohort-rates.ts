import { Decimal } from 'decimal.js';

import type { DecimalString } from '@modules/crm-integration/types/integration.types.js';
import type { CohortRates } from '../types/analytics.types.js';
import { RATE_SCALE } from './money-metrics.js';

/** Percentage rounded HALF_UP to four decimals; null when the denominator is zero. */
export function percentage(numerator: number, denominator: number): DecimalString | null {
  if (denominator <= 0) return null;
  return new Decimal(numerator)
    .times(100)
    .div(denominator)
    .toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP)
    .toFixed();
}

/** Formats a database average with the same rounding as every other rate. */
export function roundRate(value: string | null): DecimalString | null {
  if (value === null) return null;
  return new Decimal(value).toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP).toFixed();
}

/**
 * Funnel rates of one cohort. A positive denominator without conversions is a real `0`; an empty
 * denominator is `null` with a reason, while the counts themselves stay `0`.
 */
export function calculateRates(counts: {
  leads: number;
  convertedLeads: number;
  wonLeads: number;
}): CohortRates {
  const rates: CohortRates = {
    leadToDealRate: percentage(counts.convertedLeads, counts.leads),
    leadToWonRate: percentage(counts.wonLeads, counts.leads),
    dealToWonRate: percentage(counts.wonLeads, counts.convertedLeads),
    reasons: {},
  };
  if (counts.leads <= 0) {
    rates.reasons.leadToDealRate = 'zero_leads';
    rates.reasons.leadToWonRate = 'zero_leads';
  }
  if (counts.convertedLeads <= 0) rates.reasons.dealToWonRate = 'zero_converted_leads';
  return rates;
}
