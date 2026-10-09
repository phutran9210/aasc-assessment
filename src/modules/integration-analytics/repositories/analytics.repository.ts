import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { AnalyticsRevisionEntity } from '../entities/analytics-revision.entity.js';
import { CampaignDailyEntity } from '../entities/campaign-daily.entity.js';

export type CohortFilter = {
  advertiserId: string;
  from: string;
  to: string;
  campaignId?: string;
};

export type CohortRow = {
  campaignId: string | null;
  leads: number;
  convertedLeads: number;
  wonLeads: number;
  everWonLeads: number;
  openDeals: number;
  lostDeals: number;
  deletedDeals: number;
  missingAmountDeals: number;
  averageScore: string | null;
};

export type RevenueRow = { campaignId: string; currency: string; revenue: string };

const COMPLETED = `deal.conversion_status = 'completed'`;
const LIVE = `${COMPLETED} AND deal.stage_deleted_at IS NULL`;
const WON = `${LIVE} AND deal.stage_semantics = 'won'`;
const PENDING_STATUSES = ['pending', 'processing', 'retry_wait'];
const DATA_OPERATION_KINDS = [
  'tiktok_ingest',
  'bitrix_lead_sync',
  'bitrix_deal_convert',
  'bitrix_deal_refresh',
  'historical_lead_import',
  'campaign_cost_import',
];

/**
 * Aggregates run on the lead row, the unit of counting. The deal join is one-to-one
 * (`uq_integration_deal_lead`) and neither submissions nor deal history are joined, so repeated
 * submissions or stage changes can never multiply a count or an amount.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async revision(manager: EntityManager = this.dataSource.manager): Promise<string> {
    const row = await manager
      .getRepository(AnalyticsRevisionEntity)
      .createQueryBuilder('revision')
      .select('revision.revision', 'revision')
      .getRawOne<{ revision: string }>();
    return row?.revision ?? '0';
  }

  /** Runs every read of one response on a single read-only REPEATABLE READ snapshot. */
  snapshot<T>(work: (manager: EntityManager, dataAsOf: string) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      // The first query fixes the snapshot, so its clock reading is the moment the data is as of.
      const [row] = await manager.query<Array<{ as_of: Date }>>(
        'SELECT clock_timestamp() AS as_of',
      );
      return work(manager, new Date(row.as_of).toISOString());
    });
  }

  async cohort(filter: CohortFilter, manager: EntityManager): Promise<CohortRow> {
    const row = await this.cohortQuery(filter, manager).getRawOne<RawCohortRow>();
    return toCohortRow(null, row);
  }

  async cohortsByCampaign(
    filter: CohortFilter,
    campaignIds: string[],
    manager: EntityManager,
  ): Promise<CohortRow[]> {
    if (!campaignIds.length) return [];
    const rows = await this.cohortQuery(filter, manager)
      .addSelect('lead.first_touch_campaign_id', 'campaignId')
      .andWhere('lead.first_touch_campaign_id IN (:...campaignIds)', { campaignIds })
      .groupBy('lead.first_touch_campaign_id')
      .getRawMany<RawCohortRow & { campaignId: string }>();
    return rows.map((row) => toCohortRow(row.campaignId, row));
  }

  /** Current amount of deals that are won right now, summed inside one currency. */
  revenueByCampaign(
    filter: CohortFilter,
    campaignIds: string[],
    manager: EntityManager,
  ): Promise<RevenueRow[]> {
    if (!campaignIds.length) return Promise.resolve([]);
    return this.leads(filter, manager)
      .innerJoin(DealEntity, 'deal', 'deal.lead_id = lead.id')
      .select('lead.first_touch_campaign_id', 'campaignId')
      .addSelect('deal.currency', 'currency')
      .addSelect('SUM(deal.amount)::text', 'revenue')
      .andWhere(WON)
      .andWhere('deal.amount IS NOT NULL AND deal.currency IS NOT NULL')
      .andWhere('lead.first_touch_campaign_id IN (:...campaignIds)', { campaignIds })
      .groupBy('lead.first_touch_campaign_id')
      .addGroupBy('deal.currency')
      .getRawMany<RevenueRow>();
  }

  async unattributedLeads(filter: CohortFilter, manager: EntityManager): Promise<number> {
    const row = await this.leads(filter, manager)
      .select('COUNT(*)', 'count')
      .andWhere('lead.first_touch_campaign_id IS NULL')
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
  }

  /** Completed lead forms in the period, by the campaign of the submission itself. */
  async submissions(
    filter: CohortFilter,
    manager: EntityManager,
  ): Promise<Map<string | null, number>> {
    const builder = manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder('submission')
      .select('submission.campaign_id', 'campaignId')
      .addSelect('COUNT(*)', 'count')
      .where('submission.advertiser_id = :advertiserId', { advertiserId: filter.advertiserId })
      .andWhere('submission.lead_id IS NOT NULL')
      .andWhere(`submission.engagement ->> 'event' = 'form_complete'`)
      .andWhere('submission.occurred_at >= :from AND submission.occurred_at < :to', {
        from: filter.from,
        to: filter.to,
      })
      .groupBy('submission.campaign_id');
    if (filter.campaignId !== undefined) {
      builder.andWhere('submission.campaign_id = :campaignId', { campaignId: filter.campaignId });
    }
    const rows = await builder.getRawMany<{ campaignId: string | null; count: string }>();
    return new Map(rows.map((row) => [row.campaignId, Number(row.count)]));
  }

  /** Campaigns that have a first-touch lead in the period or a cost row on one of its days. */
  async campaignIds(
    filter: CohortFilter,
    days: { fromDate: string; toDate: string; currency?: string },
    manager: EntityManager,
  ): Promise<string[]> {
    const leadCampaigns = await this.leads(filter, manager)
      .select('DISTINCT lead.first_touch_campaign_id', 'campaignId')
      .andWhere('lead.first_touch_campaign_id IS NOT NULL')
      .getRawMany<{ campaignId: string }>();
    const costBuilder = manager
      .getRepository(CampaignDailyEntity)
      .createQueryBuilder('cost')
      .select('DISTINCT cost.campaign_id', 'campaignId')
      .where('cost.advertiser_id = :advertiserId', { advertiserId: filter.advertiserId })
      .andWhere('cost.report_date >= :fromDate AND cost.report_date < :toDate', days);
    if (days.currency) costBuilder.andWhere('cost.currency = :currency', days);
    const costCampaigns = await costBuilder.getRawMany<{ campaignId: string }>();
    return [...new Set([...leadCampaigns, ...costCampaigns].map((row) => row.campaignId))].sort();
  }

  async oldestPendingOperation(manager: EntityManager): Promise<string | null> {
    const row = await manager
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .select('MIN(operation.created_at)', 'oldest')
      .where('operation.status IN (:...statuses)', { statuses: PENDING_STATUSES })
      .andWhere('operation.kind IN (:...kinds)', { kinds: DATA_OPERATION_KINDS })
      .getRawOne<{ oldest: Date | null }>();
    return row?.oldest ? new Date(row.oldest).toISOString() : null;
  }

  /** Leads holding interaction points, the only ones a sliding window can change; keyset paged. */
  async scoreCandidates(afterId: string | null, limit: number): Promise<string[]> {
    const builder = this.dataSource
      .getRepository(LeadEntity)
      .createQueryBuilder('lead')
      .select('lead.id', 'id')
      .where(`COALESCE((lead.score_breakdown ->> 'interaction')::numeric, 0) > 0`)
      .orderBy('lead.id', 'ASC')
      .limit(limit);
    if (afterId) builder.andWhere('lead.id > :afterId', { afterId });
    return (await builder.getRawMany<{ id: string }>()).map((row) => row.id);
  }

  private leads(filter: CohortFilter, manager: EntityManager): SelectQueryBuilder<LeadEntity> {
    const builder = manager
      .getRepository(LeadEntity)
      .createQueryBuilder('lead')
      .where('lead.advertiser_id = :advertiserId', { advertiserId: filter.advertiserId })
      .andWhere('lead.first_touch_at >= :from AND lead.first_touch_at < :to', {
        from: filter.from,
        to: filter.to,
      });
    if (filter.campaignId !== undefined) {
      builder.andWhere('lead.first_touch_campaign_id = :campaignId', {
        campaignId: filter.campaignId,
      });
    }
    return builder;
  }

  private cohortQuery(filter: CohortFilter, manager: EntityManager) {
    return this.leads(filter, manager)
      .leftJoin(DealEntity, 'deal', 'deal.lead_id = lead.id')
      .select('COUNT(*)', 'leads')
      .addSelect(`COUNT(*) FILTER (WHERE ${COMPLETED})`, 'convertedLeads')
      .addSelect(`COUNT(*) FILTER (WHERE ${WON})`, 'wonLeads')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${COMPLETED} AND deal.ever_won_at IS NOT NULL)`,
        'everWonLeads',
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${LIVE} AND deal.stage_semantics = 'open')`, 'openDeals')
      .addSelect(`COUNT(*) FILTER (WHERE ${LIVE} AND deal.stage_semantics = 'lost')`, 'lostDeals')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${COMPLETED} AND deal.stage_deleted_at IS NOT NULL)`,
        'deletedDeals',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${WON} AND (deal.amount IS NULL OR deal.currency IS NULL))`,
        'missingAmountDeals',
      )
      .addSelect('AVG(lead.score)::text', 'averageScore');
  }
}

type RawCohortRow = Record<
  | 'leads'
  | 'convertedLeads'
  | 'wonLeads'
  | 'everWonLeads'
  | 'openDeals'
  | 'lostDeals'
  | 'deletedDeals'
  | 'missingAmountDeals',
  string
> & { averageScore: string | null };

function toCohortRow(campaignId: string | null, row: RawCohortRow | undefined): CohortRow {
  return {
    campaignId,
    leads: Number(row?.leads ?? 0),
    convertedLeads: Number(row?.convertedLeads ?? 0),
    wonLeads: Number(row?.wonLeads ?? 0),
    everWonLeads: Number(row?.everWonLeads ?? 0),
    openDeals: Number(row?.openDeals ?? 0),
    lostDeals: Number(row?.lostDeals ?? 0),
    deletedDeals: Number(row?.deletedDeals ?? 0),
    missingAmountDeals: Number(row?.missingAmountDeals ?? 0),
    averageScore: row?.averageScore ?? null,
  };
}
