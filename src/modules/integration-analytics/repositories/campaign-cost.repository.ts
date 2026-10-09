import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { CampaignDailyEntity } from '../entities/campaign-daily.entity.js';
import type { CampaignCostQuery, CampaignCostSource } from '../types/analytics.types.js';

export type CampaignCostAggregate = {
  campaignId: string;
  currency: string;
  spend: string;
  impressions: string | null;
  clicks: string | null;
  coveredDays: number;
  sources: CampaignCostSource[];
  fetchedAt: Date;
};

type AggregateRow = Omit<CampaignCostAggregate, 'coveredDays'> & { coveredDays: string };

const NATURAL_KEY = ['advertiser_id', 'campaign_id', 'report_date', 'currency'];
const MUTABLE_COLUMNS = [
  'reporting_timezone',
  'spend',
  'impressions',
  'clicks',
  'source',
  'fetched_at',
  'updated_at',
];

@Injectable()
export class CampaignCostRepository {
  /** Locks the stored rows of the given campaigns/days so a batch can be compared before writing. */
  findForUpdate(
    advertiserId: string,
    campaignIds: string[],
    reportDates: string[],
    manager: EntityManager,
  ): Promise<CampaignDailyEntity[]> {
    return manager.getRepository(CampaignDailyEntity).find({
      where: { advertiserId, campaignId: In(campaignIds), reportDate: In(reportDates) },
      order: { campaignId: 'ASC', reportDate: 'ASC', currency: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async upsert(
    values: Array<QueryDeepPartialEntity<CampaignDailyEntity>>,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(CampaignDailyEntity)
      .values(values)
      .orUpdate(MUTABLE_COLUMNS, NATURAL_KEY)
      .execute();
  }

  async touch(
    ids: string[],
    source: CampaignCostSource,
    fetchedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(CampaignDailyEntity)
      .set({ source, fetchedAt, updatedAt: () => 'updated_at' })
      .where({ id: In(ids) })
      .execute();
  }

  /** Sums per campaign and currency inside PostgreSQL; numeric and bigint totals come back as text. */
  async aggregate(
    query: CampaignCostQuery,
    manager: EntityManager,
  ): Promise<CampaignCostAggregate[]> {
    if (!query.campaignIds.length) return [];
    const builder = manager
      .getRepository(CampaignDailyEntity)
      .createQueryBuilder('cost')
      .select('cost.campaign_id', 'campaignId')
      .addSelect('cost.currency', 'currency')
      .addSelect('SUM(cost.spend)::text', 'spend')
      .addSelect('SUM(cost.impressions)::text', 'impressions')
      .addSelect('SUM(cost.clicks)::text', 'clicks')
      .addSelect('COUNT(DISTINCT cost.report_date)', 'coveredDays')
      .addSelect('ARRAY_AGG(DISTINCT cost.source ORDER BY cost.source)', 'sources')
      .addSelect('MAX(cost.fetched_at)', 'fetchedAt')
      .where('cost.advertiser_id = :advertiserId', { advertiserId: query.advertiserId })
      .andWhere('cost.campaign_id IN (:...campaignIds)', { campaignIds: query.campaignIds })
      .andWhere('cost.report_date >= :fromDate AND cost.report_date < :toDate', {
        fromDate: query.fromDate,
        toDate: query.toDate,
      })
      .groupBy('cost.campaign_id')
      .addGroupBy('cost.currency')
      .orderBy('cost.campaign_id', 'ASC')
      .addOrderBy('cost.currency', 'ASC');
    if (query.currency) builder.andWhere('cost.currency = :currency', { currency: query.currency });

    const rows = await builder.getRawMany<AggregateRow>();
    return rows.map((row) => ({ ...row, coveredDays: Number(row.coveredDays) }));
  }
}
