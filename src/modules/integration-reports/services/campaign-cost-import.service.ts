import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OPERATION_KINDS } from '@core/queue/constants/operation.constants.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { normalizeCostRow } from '@modules/integration-analytics/domain/cost-row.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import type { CampaignCostRow } from '@modules/integration-analytics/types/analytics.types.js';
import { COST_IMPORT_SCHEMA } from '../domain/import-parser.js';
import type { RowErrorInput } from '../repositories/report-row-error.repository.js';
import type { ReportJobDto } from '../types/report.types.js';
import { IMPORT_CHUNK_SIZE, ImportJobSupport } from './import-job.support.js';
import type { ChunkResult, UploadedImport } from './import-job.support.js';

export type CostImportScope = { advertiserId: string; reportTimezone: string };

@Injectable()
export class CampaignCostImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly support: ImportJobSupport,
    private readonly costs: CampaignCostService,
    private readonly scope: CostImportScope,
  ) {}

  /** Registers a daily cost CSV with advertiser, campaign, date, currency and spend columns. */
  start(file: UploadedImport, actor: Actor): Promise<ReportJobDto> {
    return this.support.register({
      file,
      schema: COST_IMPORT_SCHEMA,
      formats: ['csv'],
      filters: {
        type: 'campaign_costs',
        advertiserId: this.scope.advertiserId,
        reportingTimezone: this.scope.reportTimezone,
      },
      operationKind: OPERATION_KINDS.campaignCostImport,
      operationKey: (jobId) => `cost-import/${jobId}`,
      actor,
    });
  }

  /**
   * Upserts the valid rows of one chunk and advances the cursor in the same transaction. Amounts
   * stay decimal strings; a row that would need rounding is reported instead of altered, and a
   * day without a row is simply absent, never written as zero.
   */
  async processChunk(
    jobId: string,
    cursor: number,
    limit = IMPORT_CHUNK_SIZE,
  ): Promise<ChunkResult> {
    const { job, records } = await this.support.load(jobId, COST_IMPORT_SCHEMA);
    if (Number(job.cursor ?? 0) !== cursor || job.status === 'completed') {
      return this.support.replayed(job);
    }

    const chunk = records.slice(cursor, cursor + limit);
    const errors: RowErrorInput[] = [];
    const rows: CampaignCostRow[] = [];
    for (const record of chunk) {
      if (!record.values) {
        errors.push({
          rowNumber: record.rowNumber,
          sourceKey: null,
          errorCode: record.errorCode ?? 'ROW_MALFORMED',
        });
        continue;
      }
      const values = record.values;
      const text = (key: string) => (values[key] ?? '').trim();
      const sourceKey = `${text('campaign_id')}/${text('date')}/${text('currency').toUpperCase()}`;
      if (text('advertiser_id') !== this.scope.advertiserId) {
        errors.push({
          rowNumber: record.rowNumber,
          sourceKey,
          errorCode: 'ADVERTISER_MISMATCH',
          redactedDetail: 'advertiser_id',
        });
        continue;
      }
      const normalized = normalizeCostRow({
        advertiserId: this.scope.advertiserId,
        campaignId: text('campaign_id'),
        reportDate: text('date'),
        reportingTimezone: this.scope.reportTimezone,
        currency: text('currency'),
        spend: text('spend'),
        impressions: text('impressions') || null,
        clicks: text('clicks') || null,
      });
      if (normalized.ok) rows.push(normalized.row);
      else {
        errors.push({
          rowNumber: record.rowNumber,
          sourceKey,
          errorCode: `COST_${normalized.issue.code.toUpperCase()}`,
          redactedDetail: normalized.issue.field,
        });
      }
    }

    const nextCursor = cursor + chunk.length;
    const result: ChunkResult = {
      processed: chunk.length,
      succeeded: rows.length,
      failed: errors.length,
      nextCursor,
      done: nextCursor >= records.length,
    };
    await this.dataSource.transaction(async (tx) => {
      if (!(await this.support.checkpoint(jobId, cursor, result, null, tx))) return;
      await this.support.recordErrors(jobId, errors, tx);
      if (rows.length) await this.costs.upsert(rows, 'import', tx);
    });
    return result;
  }
}
