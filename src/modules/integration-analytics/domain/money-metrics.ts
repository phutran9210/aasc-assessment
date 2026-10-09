import { Decimal } from 'decimal.js';

import type { DecimalString } from '@modules/crm-integration/types/integration.types.js';
import type { FinancialInput, FinancialMetrics } from '../types/analytics.types.js';

export const MONEY_SCALE = 4;
export const RATE_SCALE = 4;

// A private constructor keeps the precision independent of any other Decimal user in the process;
// 60 significant digits cover numeric(20,4) sums and their ratios without rounding early.
const Precise = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

function round(value: Decimal, scale: number): DecimalString {
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed();
}

/** Formats an amount as a plain decimal string rounded HALF_UP to four decimal places. */
export function toMoneyString(value: DecimalString | Decimal): DecimalString {
  return round(new Precise(value), MONEY_SCALE);
}

/** Adds amounts of a single currency exactly; callers must never mix currencies. */
export function sumMoney(values: readonly DecimalString[]): DecimalString {
  return toMoneyString(values.reduce((total, value) => total.plus(value), new Precise(0)));
}

/**
 * CPL, revenue ROI (%) and ROAS. A ratio is `null` with a reason instead of a guessed number when
 * the spend or revenue is incomplete or its denominator is zero; a real zero spend stays a value.
 */
export function calculateFinancials(input: FinancialInput): FinancialMetrics {
  const spend = input.spend === null ? null : new Precise(input.spend);
  const revenue = input.revenue === null ? null : new Precise(input.revenue);
  const spendComplete = input.costComplete && spend !== null;
  const revenueComplete = input.revenueComplete && revenue !== null;
  const metrics: FinancialMetrics = {
    knownSpend: spend === null ? null : toMoneyString(spend),
    revenue: revenue === null ? null : toMoneyString(revenue),
    spendComplete,
    revenueComplete,
    cpl: null,
    roi: null,
    roas: null,
    reasons: {},
  };

  if (!spendComplete || spend === null) {
    metrics.reasons = {
      cpl: 'spend_incomplete',
      roi: 'spend_incomplete',
      roas: 'spend_incomplete',
    };
    return metrics;
  }

  if (input.leads > 0) metrics.cpl = round(spend.div(input.leads), MONEY_SCALE);
  else metrics.reasons.cpl = 'zero_leads';

  if (!revenueComplete || revenue === null) {
    metrics.reasons.roi = 'revenue_incomplete';
    metrics.reasons.roas = 'revenue_incomplete';
  } else if (spend.isZero()) {
    metrics.reasons.roi = 'zero_spend';
    metrics.reasons.roas = 'zero_spend';
  } else {
    metrics.roi = round(revenue.minus(spend).div(spend).times(100), RATE_SCALE);
    metrics.roas = round(revenue.div(spend), RATE_SCALE);
  }
  return metrics;
}
