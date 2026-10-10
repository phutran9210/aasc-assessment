import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '@core/queue/types/worker.types.js';
import { ReportJobRepository } from '../repositories/report-job.repository.js';
import { CampaignCostImportService } from '../services/campaign-cost-import.service.js';
import { IMPORT_CHUNK_SIZE } from '../services/import-job.support.js';
import { LeadImportService } from '../services/lead-import.service.js';

const MAX_ATTEMPTS = 5;
const WORKER_ABANDONED = 'REPORT_WORKER_ABANDONED';
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 60_000;

/** Drives an import job chunk by chunk from its durable cursor until the file is exhausted. */
@Injectable()
export class ImportHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: ReportJobRepository,
    private readonly leadImports: LeadImportService,
    private readonly costImports: CampaignCostImportService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    const jobId = operation?.payload.reportJobId;
    const job = jobId ? await this.jobs.findById(jobId) : null;
    if (!job || job.kind !== 'import') {
      return { outcome: 'quarantined', errorCode: 'REPORT_JOB_NOT_FOUND' };
    }
    if (job.status === 'completed') return { outcome: 'succeeded' };
    if (job.status === 'failed') return { outcome: 'quarantined', errorCode: 'REPORT_JOB_FAILED' };
    if (context.attempt > MAX_ATTEMPTS) {
      // Earlier attempts died without reporting, so the job is closed instead of staying active.
      await this.jobs.update(job.id, { status: 'failed', errorSummary: WORKER_ABANDONED });
      return { outcome: 'dead_letter', errorCode: WORKER_ABANDONED };
    }

    try {
      let cursor = Number(job.cursor ?? 0);
      for (;;) {
        await context.assertOwnership();
        const result =
          job.filters.type === 'campaign_costs'
            ? await this.costImports.processChunk(job.id, cursor, IMPORT_CHUNK_SIZE)
            : await this.leadImports.processChunk(job.id, cursor, IMPORT_CHUNK_SIZE, context);
        if (result.done) return { outcome: 'succeeded' };
        cursor = result.nextCursor;
      }
    } catch {
      // The cursor of the last committed chunk is kept, so a retry resumes instead of restarting.
      const errorCode = 'IMPORT_FAILED';
      if (context.attempt >= MAX_ATTEMPTS) {
        await this.jobs.update(job.id, { status: 'failed', errorSummary: errorCode });
        return { outcome: 'dead_letter', errorCode };
      }
      await this.jobs.update(job.id, { errorSummary: errorCode });
      return {
        outcome: 'retry_wait',
        errorCode,
        nextAttemptAt: new Date(
          Date.now() + Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (context.attempt - 1)),
        ),
      };
    }
  }
}
