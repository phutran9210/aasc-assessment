import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { Temporal, nowDate } from '@common/utils/temporal.util.js';
import { normalizeCostRow } from '../domain/cost-row.js';
import type { NormalizedCostRow } from '../domain/cost-row.js';
import { toMoneyString } from '../domain/money-metrics.js';
import type { CampaignDailyEntity } from '../entities/campaign-daily.entity.js';
import { AnalyticsRevisionRepository } from '../repositories/analytics-revision.repository.js';
import { CampaignCostRepository } from '../repositories/campaign-cost.repository.js';
import type {
  CampaignCostGroup,
  CampaignCostQuery,
  CampaignCostRow,
  CampaignCostSource,
  UpsertSummary,
} from '../types/analytics.types.js';

@Injectable()
export class CampaignCostService {
  constructor(
    private readonly costs: CampaignCostRepository,
    private readonly revisions: AnalyticsRevisionRepository,
  ) {}

  /**
   * Upserts daily costs by advertiser/campaign/day/currency inside the caller's transaction. The
   * analytics revision moves in the same transaction, and only when a stored figure changed.
   */
  async upsert(
    rows: CampaignCostRow[],
    source: CampaignCostSource,
    tx: EntityManager,
  ): Promise<UpsertSummary> {
    const summary: UpsertSummary = { inserted: 0, updated: 0, unchanged: 0 };
    const batch = this.normalizeBatch(rows);
    if (!batch.size) return summary;

    const fetchedAt = nowDate();
    const changed: Array<QueryDeepPartialEntity<CampaignDailyEntity>> = [];
    const unchangedFetchedAt = new Map<number, string[]>();

    for (const [advertiserId, advertiserRows] of groupByAdvertiser(batch)) {
      const existing = await this.costs.findForUpdate(
        advertiserId,
        unique(advertiserRows.map((row) => row.campaignId)),
        unique(advertiserRows.map((row) => row.reportDate)),
        tx,
      );
      const stored = new Map(
        existing.map((row) => [
          naturalKey(advertiserId, row.campaignId, row.reportDate, row.currency),
          row,
        ]),
      );
      for (const row of advertiserRows) {
        const current = stored.get(
          naturalKey(advertiserId, row.campaignId, row.reportDate, row.currency),
        );
        const rowFetchedAt = row.fetchedAt ?? fetchedAt;
        if (current && !isMaterialChange(current, row)) {
          summary.unchanged += 1;
          const ids = unchangedFetchedAt.get(rowFetchedAt.getTime()) ?? [];
          ids.push(current.id);
          unchangedFetchedAt.set(rowFetchedAt.getTime(), ids);
          continue;
        }
        if (current) summary.updated += 1;
        else summary.inserted += 1;
        changed.push({
          id: current?.id ?? uuidv7(),
          advertiserId,
          campaignId: row.campaignId,
          reportDate: row.reportDate,
          reportingTimezone: row.reportingTimezone,
          currency: row.currency,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          source,
          fetchedAt: rowFetchedAt,
        });
      }
    }

    if (changed.length) await this.costs.upsert(changed, tx);
    for (const [time, ids] of unchangedFetchedAt) {
      await this.costs.touch(ids, source, new Date(time), tx);
    }
    if (changed.length) await this.revisions.increment(tx);
    return summary;
  }

  /**
   * Known spend per campaign and currency for `[fromDate,toDate)`. Currencies are never added
   * together, and a group is complete only when it has a row for every requested day: a stored
   * zero counts as data, a missing day does not.
   */
  async summarize(query: CampaignCostQuery, manager: EntityManager): Promise<CampaignCostGroup[]> {
    const requestedDays = Temporal.PlainDate.from(query.fromDate).until(
      Temporal.PlainDate.from(query.toDate),
      { largestUnit: 'days' },
    ).days;
    if (requestedDays <= 0) throw new BadRequestException('fromDate must be before toDate');

    const campaignIds = unique(query.campaignIds).sort();
    const aggregates = await this.costs.aggregate({ ...query, campaignIds }, manager);
    const groups: CampaignCostGroup[] = [];
    for (const campaignId of campaignIds) {
      const found = aggregates.filter((aggregate) => aggregate.campaignId === campaignId);
      if (!found.length) {
        groups.push({
          campaignId,
          currency: null,
          knownSpend: null,
          impressions: null,
          clicks: null,
          coveredDays: 0,
          requestedDays,
          spendComplete: false,
          sources: [],
          fetchedAt: null,
        });
        continue;
      }
      for (const aggregate of found) {
        groups.push({
          campaignId,
          currency: aggregate.currency,
          knownSpend: toMoneyString(aggregate.spend),
          impressions: aggregate.impressions,
          clicks: aggregate.clicks,
          coveredDays: aggregate.coveredDays,
          requestedDays,
          spendComplete: aggregate.coveredDays === requestedDays,
          sources: aggregate.sources,
          fetchedAt: new Date(aggregate.fetchedAt).toISOString(),
        });
      }
    }
    return groups;
  }

  /** Validates every row before any write; a repeated natural key keeps its last occurrence. */
  private normalizeBatch(rows: CampaignCostRow[]): Map<string, NormalizedCostRow> {
    const batch = new Map<string, NormalizedCostRow>();
    rows.forEach((raw, index) => {
      const result = normalizeCostRow(raw);
      if (!result.ok) {
        throw new BadRequestException({
          message: 'Invalid campaign cost row',
          row: index,
          field: result.issue.field,
          code: result.issue.code,
        });
      }
      const { row } = result;
      batch.set(naturalKey(row.advertiserId, row.campaignId, row.reportDate, row.currency), row);
    });
    return batch;
  }
}

function naturalKey(
  advertiserId: string,
  campaignId: string,
  reportDate: string,
  currency: string,
): string {
  return JSON.stringify([advertiserId, campaignId, reportDate, currency]);
}

function groupByAdvertiser(batch: Map<string, NormalizedCostRow>) {
  const groups = new Map<string, NormalizedCostRow[]>();
  for (const row of batch.values()) {
    const rows = groups.get(row.advertiserId) ?? [];
    rows.push(row);
    groups.set(row.advertiserId, rows);
  }
  return groups;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isMaterialChange(current: CampaignDailyEntity, row: NormalizedCostRow): boolean {
  return (
    !new Decimal(current.spend).equals(row.spend) ||
    current.impressions !== row.impressions ||
    current.clicks !== row.clicks ||
    current.reportingTimezone !== row.reportingTimezone
  );
}
