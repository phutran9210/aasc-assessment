import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { nowIso } from '@common/utils/temporal.util.js';
import { calculateRates, roundRate } from '../domain/cohort-rates.js';
import { calculateFinancials } from '../domain/money-metrics.js';
import { resolvePeriod } from '../domain/report-period.js';
import { AnalyticsRepository } from '../repositories/analytics.repository.js';
import type { CohortFilter, CohortRow } from '../repositories/analytics.repository.js';
import type {
  AnalyticsScope,
  CampaignCostGroup,
  CampaignFinancials,
  CampaignMetrics,
  CampaignPerformance,
  CampaignPerformanceQuery,
  ConversionMetrics,
  ConversionRatesQuery,
  ReportMeta,
  ResolvedPeriod,
} from '../types/analytics.types.js';
import { AnalyticsCache } from './analytics-cache.service.js';
import { CampaignCostService } from './campaign-cost.service.js';

export const FRESHNESS_TARGET_MS = 30_000;
const CURRENCY = /^[A-Z]{3}$/;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly costs: CampaignCostService,
    private readonly cache: AnalyticsCache,
    private readonly scope: AnalyticsScope,
    private readonly clock: () => string = nowIso,
  ) {}

  /** Funnel of the leads whose first touch falls in `[from,to)`, as of one database snapshot. */
  async conversionRates(query: ConversionRatesQuery): Promise<ConversionMetrics> {
    const generatedAt = this.clock();
    const period = resolvePeriod(
      { ...query, timezone: query.timezone ?? this.scope.reportTimezone },
      'cohort',
      generatedAt,
    );
    const revision = await this.repository.revision();

    return this.cache.getOrCompute(
      this.scope,
      revision,
      { endpoint: 'conversion-rates', ...cacheQuery(query) },
      () =>
        this.repository.snapshot(async (manager, dataAsOf) => {
          const filter = this.filter(period, query.campaignId);
          const cohort = await this.repository.cohort(filter, manager);
          const submissions = await this.repository.submissions(filter, manager);
          return {
            ...(await this.meta(period, generatedAt, dataAsOf, manager)),
            campaignId: query.campaignId ?? null,
            ...counts(cohort, sum(submissions.values())),
            ...calculateRates(cohort),
          };
        }),
    );
  }

  /**
   * Spend, revenue, CPL, ROI and ROAS per first-touch campaign. Daily spend cannot be split by the
   * hour, so the period must align with calendar days of the advertiser timezone.
   */
  async campaignPerformance(query: CampaignPerformanceQuery): Promise<CampaignPerformance> {
    const generatedAt = this.clock();
    if (query.timezone !== undefined && query.timezone !== this.scope.reportTimezone) {
      throw new BadRequestException(
        `Campaign performance is reported in the advertiser timezone ${this.scope.reportTimezone}`,
      );
    }
    const currency = query.currency?.toUpperCase();
    if (currency !== undefined && !CURRENCY.test(currency)) {
      throw new BadRequestException('currency must be a three-letter ISO 4217 code');
    }
    const period = resolvePeriod(
      { ...query, timezone: this.scope.reportTimezone },
      'daily',
      generatedAt,
    );
    const days = { fromDate: period.fromDate as string, toDate: period.toDate as string };
    const revision = await this.repository.revision();

    return this.cache.getOrCompute(
      this.scope,
      revision,
      { endpoint: 'campaign-performance', ...cacheQuery(query), currency },
      () =>
        this.repository.snapshot(async (manager, dataAsOf) => {
          const filter = this.filter(period, query.campaignId);
          const all = query.campaignId
            ? [query.campaignId]
            : await this.repository.campaignIds(filter, { ...days, currency }, manager);
          const pageIds = all.slice((query.page - 1) * query.limit, query.page * query.limit);

          const cohorts = await this.repository.cohortsByCampaign(filter, pageIds, manager);
          const revenues = await this.repository.revenueByCampaign(filter, pageIds, manager);
          const submissions = await this.repository.submissions(filter, manager);
          const costGroups = pageIds.length
            ? await this.costs.summarize(
                { advertiserId: this.scope.advertiserId, campaignIds: pageIds, ...days, currency },
                manager,
              )
            : [];

          const items = pageIds.map((campaignId): CampaignMetrics => {
            const cohort =
              cohorts.find((row) => row.campaignId === campaignId) ?? emptyCohort(campaignId);
            const revenue = new Map(
              revenues
                .filter((row) => row.campaignId === campaignId)
                .filter((row) => currency === undefined || row.currency === currency)
                .map((row) => [row.currency, row.revenue]),
            );
            const groups = costGroups.filter(
              (group) => group.campaignId === campaignId && group.currency !== null,
            );
            const revenueComplete = cohort.missingAmountDeals === 0;
            return {
              campaignId,
              ...counts(cohort, submissions.get(campaignId) ?? 0),
              ...calculateRates(cohort),
              qualityScore: roundRate(cohort.averageScore),
              spendComplete: groups.length > 0 && groups.every((group) => group.spendComplete),
              revenueComplete,
              missingAmountDeals: cohort.missingAmountDeals,
              financials: financials(groups, revenue, cohort.leads, revenueComplete, period),
            };
          });

          return {
            ...(await this.meta(period, generatedAt, dataAsOf, manager)),
            items,
            total: all.length,
            page: query.page,
            limit: query.limit,
            unattributedLeads: query.campaignId
              ? 0
              : await this.repository.unattributedLeads(filter, manager),
          };
        }),
    );
  }

  private filter(period: ResolvedPeriod, campaignId: string | undefined): CohortFilter {
    return {
      advertiserId: this.scope.advertiserId,
      from: period.from,
      to: period.to,
      campaignId,
    };
  }

  private async meta(
    period: ResolvedPeriod,
    generatedAt: string,
    dataAsOf: string,
    manager: EntityManager,
  ): Promise<ReportMeta> {
    const oldestPendingAt = await this.repository.oldestPendingOperation(manager);
    return {
      period: { from: period.from, to: period.to, timezone: period.timezone },
      generatedAt,
      dataAsOf,
      attributionModel: 'first_touch',
      revenueBasis: 'cohort_to_date',
      providerMode: { tiktok: this.scope.tiktokMode, bitrix: this.scope.bitrixMode },
      revision: await this.repository.revision(manager),
      stale:
        oldestPendingAt !== null &&
        Date.parse(dataAsOf) - Date.parse(oldestPendingAt) > FRESHNESS_TARGET_MS,
      oldestPendingAt,
    };
  }
}

/** One group per currency seen in cost or revenue; amounts of different currencies never meet. */
function financials(
  costGroups: CampaignCostGroup[],
  revenue: Map<string, string>,
  leads: number,
  revenueComplete: boolean,
  period: ResolvedPeriod,
): CampaignFinancials[] {
  const currencies = [
    ...new Set([...costGroups.map((group) => group.currency as string), ...revenue.keys()]),
  ].sort();
  const requestedDays = period.days.length;
  if (!currencies.length) {
    return [
      {
        ...calculateFinancials({
          spend: null,
          revenue: revenueComplete ? '0' : null,
          leads,
          costComplete: false,
          revenueComplete,
        }),
        currency: null,
        impressions: null,
        clicks: null,
        coveredDays: 0,
        requestedDays,
        sources: [],
        costFetchedAt: null,
      },
    ];
  }
  return currencies.map((currency) => {
    const cost = costGroups.find((group) => group.currency === currency);
    return {
      ...calculateFinancials({
        spend: cost?.knownSpend ?? null,
        // No won deal in this currency is a real zero, not missing data.
        revenue: revenue.get(currency) ?? '0',
        leads,
        costComplete: cost?.spendComplete ?? false,
        revenueComplete,
      }),
      currency,
      impressions: cost?.impressions ?? null,
      clicks: cost?.clicks ?? null,
      coveredDays: cost?.coveredDays ?? 0,
      requestedDays,
      sources: cost?.sources ?? [],
      costFetchedAt: cost?.fetchedAt ?? null,
    };
  });
}

function counts(cohort: CohortRow, submissions: number) {
  return {
    leads: cohort.leads,
    submissions,
    convertedLeads: cohort.convertedLeads,
    wonLeads: cohort.wonLeads,
    everWonLeads: cohort.everWonLeads,
    openDeals: cohort.openDeals,
    lostDeals: cohort.lostDeals,
    deletedDeals: cohort.deletedDeals,
  };
}

function emptyCohort(campaignId: string): CohortRow {
  return {
    campaignId,
    leads: 0,
    convertedLeads: 0,
    wonLeads: 0,
    everWonLeads: 0,
    openDeals: 0,
    lostDeals: 0,
    deletedDeals: 0,
    missingAmountDeals: 0,
    averageScore: null,
  };
}

function cacheQuery(query: ConversionRatesQuery & { page?: number; limit?: number }) {
  return {
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    dateRange: query.dateRange,
    campaignId: query.campaignId,
    page: query.page,
    limit: query.limit,
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
