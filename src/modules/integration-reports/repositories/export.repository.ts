import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';

import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import type { ExportSourceRow } from '../domain/export-row.js';

export type ExportFilter = {
  advertiserId: string;
  from: string;
  to: string;
  campaignId?: string | null;
};

@Injectable()
export class ExportRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs an export on one read-only REPEATABLE READ snapshot with a statement timeout, so every
   * page sees the same data no matter what is committed meanwhile.
   */
  snapshot<T>(
    timeoutMs: number,
    work: (manager: EntityManager, snapshotAt: Date) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
      const [row] = await manager.query<Array<{ as_of: Date }>>(
        'SELECT clock_timestamp() AS as_of',
      );
      return work(manager, new Date(row.as_of));
    });
  }

  count(filter: ExportFilter, manager: EntityManager = this.dataSource.manager): Promise<number> {
    return this.leads(filter, manager).getCount();
  }

  /** One keyset page ordered by the time-sortable lead id; joins are one-to-one by design. */
  page(
    filter: ExportFilter,
    afterId: string | null,
    limit: number,
    manager: EntityManager,
  ): Promise<ExportSourceRow[]> {
    const builder = this.leads(filter, manager)
      .leftJoin(DealEntity, 'deal', 'deal.lead_id = lead.id')
      .leftJoin(SubmissionEntity, 'submission', 'submission.id = lead.first_submission_id')
      .select('lead.id', 'localLeadId')
      .addSelect('lead.bitrix_lead_id', 'remoteLeadId')
      .addSelect('lead.name', 'name')
      .addSelect('lead.email', 'email')
      .addSelect('lead.phone', 'phone')
      .addSelect('lead.first_touch_campaign_id', 'campaignId')
      .addSelect('submission.campaign_name', 'campaignName')
      .addSelect('submission.ad_id', 'adId')
      .addSelect('submission.ad_name', 'adName')
      .addSelect('submission.form_id', 'formId')
      .addSelect('submission.form_name', 'formName')
      .addSelect('lead.created_at', 'receivedAt')
      .addSelect('lead.score', 'score')
      .addSelect('lead.sync_status', 'syncStatus')
      .addSelect('deal.bitrix_deal_id', 'remoteDealId')
      .addSelect('deal.pipeline_id', 'pipelineId')
      .addSelect('deal.stage_id', 'stageId')
      .addSelect('deal.assigned_to', 'assignedTo')
      .addSelect('deal.amount::text', 'amount')
      .addSelect('deal.currency', 'currency')
      .addSelect('lead.converted_at', 'convertedAt')
      .orderBy('lead.id', 'ASC')
      .limit(limit);
    if (afterId) builder.andWhere('lead.id > :afterId', { afterId });
    return builder.getRawMany<ExportSourceRow>();
  }

  private leads(filter: ExportFilter, manager: EntityManager): SelectQueryBuilder<LeadEntity> {
    const builder = manager
      .getRepository(LeadEntity)
      .createQueryBuilder('lead')
      .where('lead.advertiser_id = :advertiserId', { advertiserId: filter.advertiserId })
      .andWhere('lead.created_at >= :from AND lead.created_at < :to', {
        from: filter.from,
        to: filter.to,
      });
    if (filter.campaignId) {
      builder.andWhere('lead.first_touch_campaign_id = :campaignId', {
        campaignId: filter.campaignId,
      });
    }
    return builder;
  }
}
