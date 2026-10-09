import type {
  DecimalString,
  IsoInstant,
} from '@modules/crm-integration/types/integration.types.js';

export type PeriodKind = 'cohort' | 'daily';

export type PeriodQuery = {
  from?: string;
  to?: string;
  timezone?: string;
  dateRange?: string;
};

export type PeriodDay = { date: string; start: IsoInstant; end: IsoInstant; hours: number };

export type ResolvedPeriod = {
  from: IsoInstant;
  to: IsoInstant;
  timezone: string;
  kind: PeriodKind;
  /** Calendar dates of `[from,to)` in the timezone; `toDate` is exclusive. Daily periods only. */
  fromDate: string | null;
  toDate: string | null;
  days: PeriodDay[];
};

export type FinancialInput = {
  spend: DecimalString | null;
  revenue: DecimalString | null;
  leads: number;
  costComplete: boolean;
  revenueComplete: boolean;
};

export type MetricNullReason =
  'spend_incomplete' | 'revenue_incomplete' | 'zero_spend' | 'zero_leads';

export type FinancialMetrics = {
  knownSpend: DecimalString | null;
  revenue: DecimalString | null;
  spendComplete: boolean;
  revenueComplete: boolean;
  cpl: DecimalString | null;
  roi: DecimalString | null;
  roas: DecimalString | null;
  reasons: Partial<Record<'cpl' | 'roi' | 'roas', MetricNullReason>>;
};

export type CampaignCostSource = 'mock' | 'import' | 'api';

/** External cost row; money and counters stay strings so no value passes through a float. */
export type CampaignCostRow = {
  advertiserId: string;
  campaignId: string;
  reportDate: string;
  reportingTimezone: string;
  currency: string;
  spend: DecimalString;
  impressions?: string | null;
  clicks?: string | null;
  fetchedAt?: Date;
};

export type UpsertSummary = { inserted: number; updated: number; unchanged: number };

export type CampaignCostQuery = {
  advertiserId: string;
  campaignIds: string[];
  /** Inclusive first day and exclusive last day, as calendar dates of the advertiser timezone. */
  fromDate: string;
  toDate: string;
  currency?: string;
};

export type CampaignCostGroup = {
  campaignId: string;
  /** Null when the campaign has no cost row at all in the requested days. */
  currency: string | null;
  knownSpend: DecimalString | null;
  impressions: string | null;
  clicks: string | null;
  coveredDays: number;
  requestedDays: number;
  spendComplete: boolean;
  sources: CampaignCostSource[];
  fetchedAt: IsoInstant | null;
};
