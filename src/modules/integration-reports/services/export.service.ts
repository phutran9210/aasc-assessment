import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { nowIso } from '@common/utils/temporal.util.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { resolvePeriod } from '@modules/integration-analytics/domain/report-period.js';
import { toExportRow } from '../domain/export-row.js';
import type { ReportJobEntity } from '../entities/report-job.entity.js';
import { ExportRepository } from '../repositories/export.repository.js';
import type { ExportFilter } from '../repositories/export.repository.js';
import { ReportJobRepository } from '../repositories/report-job.repository.js';
import { EXPORT_CONTENT_TYPES, EXPORT_FORMATS } from '../types/report.types.js';
import type {
  ExportArtifact,
  ExportFormat,
  ExportMetadata,
  ExportQuery,
  ExportScope,
  ReportJobDto,
} from '../types/report.types.js';
import { ArtifactService, assertJobAccess } from './artifact.service.js';
import { createExportWriter } from './export-writers.js';
import type { NotificationService } from './notification.service.js';

export const SYNC_EXPORT_ROW_LIMIT = 10_000;
export const ASYNC_EXPORT_ROW_LIMIT = 100_000;
export const SYNC_EXPORT_TIMEOUT_MS = 30_000;
export const ASYNC_EXPORT_TIMEOUT_MS = 120_000;
export const EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_EXPORT_JOBS = 2;
export const EXPORT_PAGE_SIZE = 1_000;
const MAX_ATTEMPTS = 5;
const WORKER_ABANDONED = 'REPORT_WORKER_ABANDONED';
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 60_000;

export type ExportServiceOptions = {
  syncLimit?: number;
  asyncLimit?: number;
  pageSize?: number;
  clock?: () => string;
};

type ExportPlan = {
  format: ExportFormat;
  filter: ExportFilter;
  metadata: Omit<ExportMetadata, 'snapshotAt'>;
};

@Injectable()
export class ExportService {
  private readonly syncLimit: number;
  private readonly asyncLimit: number;
  private readonly pageSize: number;
  private readonly clock: () => string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly exports: ExportRepository,
    private readonly jobs: ReportJobRepository,
    private readonly artifacts: ArtifactService,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly scope: ExportScope,
    options: ExportServiceOptions = {},
    private readonly notifications?: Pick<NotificationService, 'ensure'>,
  ) {
    this.syncLimit = options.syncLimit ?? SYNC_EXPORT_ROW_LIMIT;
    this.asyncLimit = options.asyncLimit ?? ASYNC_EXPORT_ROW_LIMIT;
    this.pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
    this.clock = options.clock ?? nowIso;
  }

  /** Synchronous export of at most 10.000 leads, streamed from a file that is removed after use. */
  async download(query: ExportQuery, actor: Actor): Promise<ExportArtifact> {
    void actor;
    const plan = this.plan(query);
    const tempPath = await this.artifacts.createTemp(plan.format);
    try {
      const written = await this.write(
        plan,
        tempPath,
        this.syncLimit,
        SYNC_EXPORT_TIMEOUT_MS,
        'EXPORT_REQUIRES_ASYNC',
      );
      const { stream, size } = await this.artifacts.openTemp(tempPath);
      return {
        stream,
        size,
        contentType: EXPORT_CONTENT_TYPES[plan.format],
        filename: `leads-${written.snapshotAt.toISOString().replace(/[-:.]/g, '')}.${plan.format}`,
        rowCount: written.rowCount,
        metadata: { ...plan.metadata, snapshotAt: written.snapshotAt.toISOString() },
      };
    } catch (error) {
      await this.artifacts.discard(tempPath);
      throw error;
    }
  }

  /** Queues an export of at most 100.000 leads; a user holds at most two active jobs. */
  async schedule(query: ExportQuery, actor: Actor): Promise<ReportJobDto> {
    const plan = this.plan(query);
    if ((await this.exports.count(plan.filter)) > this.asyncLimit) throw tooLarge(this.asyncLimit);

    const job = await this.dataSource.transaction(async (tx) => {
      await this.jobs.lockRequester(actor.sub, tx);
      if ((await this.jobs.countActive(actor.sub, 'export', tx)) >= MAX_ACTIVE_EXPORT_JOBS) {
        throw new HttpException(
          {
            code: 'EXPORT_JOB_LIMIT',
            message: `At most ${MAX_ACTIVE_EXPORT_JOBS} export jobs can be active per user`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const created = await this.jobs.create(
        {
          id: uuidv7(),
          kind: 'export',
          requesterId: actor.sub,
          filters: { format: plan.format, ...plan.metadata } as Record<string, unknown> as never,
          status: 'pending',
        },
        tx,
      );
      const operation = await this.operations.ensure(
        {
          operationKey: `report-export/${created.id}`,
          kind: OPERATION_KINDS.integrationReport,
          aggregateId: created.id,
          payload: { reportJobId: created.id },
          actorId: actor.sub,
        },
        tx,
      );
      await this.outbox.append(operation.id, QUEUE_NAMES.integrationReport, new Date(), tx);
      return created;
    });
    return toReportJobDto(job);
  }

  async getJob(jobId: string, actor: Actor): Promise<ReportJobDto> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new NotFoundException('Report job was not found');
    assertJobAccess(job, actor);
    return toReportJobDto(job);
  }

  /**
   * Worker side of an asynchronous export. Every attempt starts from a fresh snapshot and a fresh
   * temporary file: nothing an earlier attempt left behind is appended to or served, and the job
   * only becomes `completed` after the atomic rename and the database reference both succeeded.
   */
  async execute(jobId: string, context: OperationContext): Promise<OperationOutcome> {
    const job = await this.jobs.findById(jobId);
    if (!job || (job.kind !== 'export' && job.kind !== 'scheduled')) {
      return { outcome: 'quarantined', errorCode: 'REPORT_JOB_NOT_FOUND' };
    }
    if (job.status === 'completed') return { outcome: 'succeeded' };
    if (job.status === 'failed') return { outcome: 'quarantined', errorCode: 'REPORT_JOB_FAILED' };
    if (context.attempt > MAX_ATTEMPTS) {
      // Earlier attempts died without reporting. The job is closed so it stops counting against
      // the requester's active jobs.
      await this.artifacts.purgeJob(jobId);
      await this.jobs.update(jobId, { status: 'failed', errorSummary: WORKER_ABANDONED });
      return { outcome: 'dead_letter', errorCode: WORKER_ABANDONED };
    }

    await context.assertOwnership?.();
    await this.jobs.update(jobId, { status: 'running' });
    await this.artifacts.purgeJob(jobId);
    const plan = planFromJob(job, this.scope);
    const tempPath = await this.artifacts.createTemp(plan.format);
    try {
      const written = await this.write(
        plan,
        tempPath,
        this.asyncLimit,
        ASYNC_EXPORT_TIMEOUT_MS,
        'EXPORT_TOO_LARGE',
      );
      await context.assertOwnership?.();
      const artifact = await this.artifacts.finalize(tempPath, jobId);
      await this.dataSource.transaction(async (tx) => {
        await this.jobs.complete(
          jobId,
          {
            artifactPath: artifact.path,
            artifactHash: artifact.hash,
            totalRows: written.rowCount,
            snapshotAt: written.snapshotAt,
            expiresAt: new Date(Date.now() + EXPORT_ARTIFACT_TTL_MS),
          },
          tx,
        );
        if (job.kind !== 'scheduled') return;
        // The link is announced in the transaction that makes the artifact downloadable.
        await this.notifications?.ensure(
          {
            dedupKey: `report-ready/${jobId}`,
            type: 'report.ready',
            payload: {
              jobId,
              reportType: job.filters.reportType,
              period: job.filters.period,
              rows: written.rowCount,
              link: `/api/v1/reports/jobs/${jobId}/download`,
            },
          },
          tx,
        );
      });
      return { outcome: 'succeeded' };
    } catch (error) {
      await this.artifacts.discard(tempPath);
      const errorCode = exportErrorCode(error);
      if (errorCode === 'EXPORT_TOO_LARGE' || context.attempt >= MAX_ATTEMPTS) {
        await this.artifacts.purgeJob(jobId);
        await this.jobs.update(jobId, { status: 'failed', errorSummary: errorCode });
        return { outcome: 'dead_letter', errorCode };
      }
      await this.jobs.update(jobId, { status: 'pending', errorSummary: errorCode });
      return {
        outcome: 'retry_wait',
        errorCode,
        nextAttemptAt: new Date(
          Date.now() + Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (context.attempt - 1)),
        ),
      };
    }
  }

  private plan(query: ExportQuery): ExportPlan {
    const period = resolvePeriod(
      {
        from: query.from,
        to: query.to,
        dateRange: query.dateRange,
        timezone: query.timezone ?? this.scope.reportTimezone,
      },
      'cohort',
      this.clock(),
    );
    const campaignId = query.campaignId ?? null;
    return {
      format: query.format,
      filter: {
        advertiserId: this.scope.advertiserId,
        from: period.from,
        to: period.to,
        campaignId,
      },
      metadata: {
        scope: 'leads',
        from: period.from,
        to: period.to,
        timezone: period.timezone,
        timeBasis: 'createdAt',
        providerMode: { tiktok: this.scope.tiktokMode, bitrix: this.scope.bitrixMode },
        campaignId,
      },
    };
  }

  private write(
    plan: ExportPlan,
    path: string,
    limit: number,
    timeoutMs: number,
    limitCode: 'EXPORT_REQUIRES_ASYNC' | 'EXPORT_TOO_LARGE',
  ): Promise<{ rowCount: number; snapshotAt: Date }> {
    const deadline = Date.now() + timeoutMs;
    return this.exports.snapshot(timeoutMs, async (manager, snapshotAt) => {
      if ((await this.exports.count(plan.filter, manager)) > limit) {
        throw limitCode === 'EXPORT_TOO_LARGE' ? tooLarge(limit) : requiresAsync(limit);
      }
      const writer = createExportWriter(plan.format, path);
      try {
        let rowCount = 0;
        let cursor: string | null = null;
        for (;;) {
          if (Date.now() > deadline) {
            throw new ServiceUnavailableException({
              code: 'EXPORT_TIMEOUT',
              message: 'Export took too long; narrow the period',
            });
          }
          const rows = await this.exports.page(plan.filter, cursor, this.pageSize, manager);
          if (!rows.length) break;
          await writer.write(rows.map(toExportRow));
          rowCount += rows.length;
          cursor = rows[rows.length - 1].localLeadId;
          if (rows.length < this.pageSize) break;
        }
        await writer.close();
        return { rowCount, snapshotAt };
      } catch (error) {
        await writer.abort();
        throw error;
      }
    });
  }
}

export function toReportJobDto(job: ReportJobEntity): ReportJobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    format: typeof job.filters.format === 'string' ? job.filters.format : null,
    filters: job.filters,
    snapshotAt: job.snapshotAt?.toISOString() ?? null,
    totalRows: job.totalRows,
    successRows: job.successRows,
    failedRows: job.failedRows,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    errorSummary: job.errorSummary,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/** Rebuilds the plan stored at scheduling time; the advertiser always comes from this deployment. */
function planFromJob(job: ReportJobEntity, scope: ExportScope): ExportPlan {
  const filters = job.filters as Record<string, string | null> & {
    providerMode: ExportMetadata['providerMode'];
  };
  const format = EXPORT_FORMATS.find((candidate) => candidate === filters.format) ?? 'csv';
  return {
    format,
    filter: {
      advertiserId: scope.advertiserId,
      from: filters.from as string,
      to: filters.to as string,
      campaignId: filters.campaignId,
    },
    metadata: {
      scope: 'leads',
      from: filters.from as string,
      to: filters.to as string,
      timezone: filters.timezone as string,
      timeBasis: 'createdAt',
      providerMode: filters.providerMode,
      campaignId: filters.campaignId,
    },
  };
}

function requiresAsync(limit: number): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'EXPORT_REQUIRES_ASYNC',
    message: `More than ${limit} leads match; create an asynchronous export instead`,
  });
}

function tooLarge(limit: number): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'EXPORT_TOO_LARGE',
    message: `More than ${limit} leads match; split the period into smaller ranges`,
  });
}

function exportErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      return String(response.code);
    }
  }
  return 'EXPORT_FAILED';
}
