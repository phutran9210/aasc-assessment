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

export type AnalyticsScope = {
  advertiserId: string;
  portalKey: string;
  tiktokMode: 'mock' | 'business-api';
  bitrixMode: 'mock' | 'real';
  /** Advertiser timezone that daily cost rows are reported in. */
  reportTimezone: string;
};

export type ConversionRatesQuery = PeriodQuery & { campaignId?: string };

export type CampaignPerformanceQuery = PeriodQuery & {
  campaignId?: string;
  currency?: string;
  page: number;
  limit: number;
};

export type RateNullReason = 'zero_leads' | 'zero_converted_leads';

export type CohortCounts = {
  leads: number;
  submissions: number;
  convertedLeads: number;
  wonLeads: number;
  everWonLeads: number;
  openDeals: number;
  lostDeals: number;
  deletedDeals: number;
};

export type CohortRates = {
  leadToDealRate: DecimalString | null;
  leadToWonRate: DecimalString | null;
  dealToWonRate: DecimalString | null;
  reasons: Partial<Record<'leadToDealRate' | 'leadToWonRate' | 'dealToWonRate', RateNullReason>>;
};

export type ReportMeta = {
  period: { from: IsoInstant; to: IsoInstant; timezone: string };
  generatedAt: IsoInstant;
  /** Instant of the single database snapshot every figure of the response was read from. */
  dataAsOf: IsoInstant;
  attributionModel: 'first_touch';
  revenueBasis: 'cohort_to_date';
  providerMode: { tiktok: AnalyticsScope['tiktokMode']; bitrix: AnalyticsScope['bitrixMode'] };
  revision: string;
  /** True while work accepted more than 30 seconds before `dataAsOf` is still unprocessed. */
  stale: boolean;
  oldestPendingAt: IsoInstant | null;
};

export type ConversionMetrics = ReportMeta &
  CohortCounts &
  CohortRates & { campaignId: string | null };

export type CampaignFinancials = FinancialMetrics & {
  currency: string | null;
  impressions: string | null;
  clicks: string | null;
  coveredDays: number;
  requestedDays: number;
  sources: CampaignCostSource[];
  costFetchedAt: IsoInstant | null;
};

export type CampaignMetrics = CohortCounts &
  CohortRates & {
    campaignId: string;
    /** Average lead score of the cohort, null when the campaign has no lead in the period. */
    qualityScore: DecimalString | null;
    spendComplete: boolean;
    revenueComplete: boolean;
    /** Won deals of the cohort without an amount or currency; they make revenue incomplete. */
    missingAmountDeals: number;
    financials: CampaignFinancials[];
  };

export type CampaignPerformance = ReportMeta & {
  items: CampaignMetrics[];
  total: number;
  page: number;
  limit: number;
  /** Leads of the period without a first-touch campaign; they appear in no campaign row. */
  unattributedLeads: number;
};
