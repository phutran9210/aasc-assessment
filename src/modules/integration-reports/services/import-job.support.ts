import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OPERATION_QUEUE } from '@core/queue/constants/operation.constants.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationKind } from '@core/queue/types/operation.types.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { readImportRecords } from '../domain/import-parser.js';
import type { ImportFormat, ImportRecord, ImportSchema } from '../domain/import-parser.js';
import { ReportJobEntity } from '../entities/report-job.entity.js';
import { ReportJobRepository } from '../repositories/report-job.repository.js';
import { ReportRowErrorRepository } from '../repositories/report-row-error.repository.js';
import type { RowErrorInput } from '../repositories/report-row-error.repository.js';
import type { ReportJobDto } from '../types/report.types.js';
import { ArtifactService, IMPORT_FORMATS } from './artifact.service.js';
import { toReportJobDto } from './export.service.js';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const IMPORT_CHUNK_SIZE = 200;

/** A file already streamed to the server's own temporary directory by the upload layer. */
export type UploadedImport = { path: string; originalName: string; size: number };

export type ChunkResult = {
  processed: number;
  succeeded: number;
  failed: number;
  nextCursor: number;
  done: boolean;
};

export type ImportRegistration = {
  file: UploadedImport;
  schema: ImportSchema;
  formats: readonly ImportFormat[];
  filters: Record<string, unknown>;
  operationKind: OperationKind;
  operationKey: (jobId: string) => string;
  actor: Actor;
  /** Extra writes that must commit together with the job, such as its audit record. */
  beforeCommit?: (jobId: string, tx: EntityManager) => Promise<void>;
};

/** Job bookkeeping shared by every import: stored file, durable cursor and row diagnostics. */
@Injectable()
export class ImportJobSupport {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: ReportJobRepository,
    private readonly rowErrors: ReportRowErrorRepository,
    private readonly artifacts: ArtifactService,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Checks size and structure, moves the upload to a generated name under `imports/<jobId>/` and
   * queues one operation for it. The client's file name only selects the format and is not kept.
   */
  async register(input: ImportRegistration): Promise<ReportJobDto> {
    const { file } = input;
    try {
      // The size on disk is authoritative, whatever the upload layer reported.
      if ((await stat(file.path)).size > MAX_IMPORT_BYTES) {
        throw new PayloadTooLargeException('Import file must not exceed 10 MiB');
      }
      const format = extname(file.originalName).slice(1).toLowerCase() as ImportFormat;
      if (!input.formats.includes(format)) {
        throw new BadRequestException(
          `Import file must be one of: ${input.formats.map((item) => `.${item}`).join(', ')}`,
        );
      }

      const jobId = uuidv7();
      const artifact = await this.artifacts.finalize(file.path, jobId, { area: 'imports', format });
      try {
        const stored = { id: jobId, artifactPath: artifact.path, artifactHash: artifact.hash };
        const { content } = await this.artifacts.readImport(stored as ReportJobEntity);
        const { records } = readImportRecords(format, content, input.schema);
        const job = await this.dataSource.transaction(async (tx) => {
          const created = await this.jobs.create(
            {
              id: jobId,
              kind: 'import',
              requesterId: input.actor.sub,
              filters: { ...input.filters, format, fileSize: artifact.size },
              status: 'pending',
              totalRows: records.length,
              artifactPath: artifact.path,
              artifactHash: artifact.hash,
            },
            tx,
          );
          const operation = await this.operations.ensure(
            {
              operationKey: input.operationKey(jobId),
              kind: input.operationKind,
              aggregateId: jobId,
              payload: { reportJobId: jobId },
              actorId: input.actor.sub,
            },
            tx,
          );
          await this.outbox.append(
            operation.id,
            OPERATION_QUEUE[input.operationKind],
            new Date(),
            tx,
          );
          await input.beforeCommit?.(jobId, tx);
          return created;
        });
        return toReportJobDto(job);
      } catch (error) {
        await this.artifacts.purgeJob(jobId, 'imports');
        throw error;
      }
    } catch (error) {
      await this.artifacts.discard(file.path);
      throw error;
    }
  }

  /** Loads an import job and the records of its stored, checksum-verified file. */
  async load(
    jobId: string,
    schema: ImportSchema,
  ): Promise<{ job: ReportJobEntity; records: ImportRecord[] }> {
    const job = await this.jobs.findById(jobId);
    if (!job || job.kind !== 'import') throw new BadRequestException('Import job was not found');
    const { content, format } = await this.artifacts.readImport(job);
    if (!(IMPORT_FORMATS as readonly string[]).includes(format)) {
      throw new BadRequestException('Import file format is not supported');
    }
    return { job, records: readImportRecords(format as ImportFormat, content, schema).records };
  }

  recordErrors(jobId: string, errors: RowErrorInput[], manager?: EntityManager): Promise<void> {
    return this.rowErrors.record(jobId, errors, manager);
  }

  /**
   * Advances the durable cursor and the row counters in one statement set. It only applies when
   * the job still stands at the cursor the chunk started from, so a replayed chunk counts once.
   */
  async checkpoint(
    jobId: string,
    cursor: number,
    result: ChunkResult,
    filters: Record<string, unknown> | null,
    manager: EntityManager,
  ): Promise<boolean> {
    const job = await manager
      .getRepository(ReportJobEntity)
      .findOne({ where: { id: jobId }, lock: { mode: 'pessimistic_write' } });
    if (!job || Number(job.cursor ?? 0) !== cursor || job.status === 'completed') return false;
    await manager.getRepository(ReportJobEntity).update(jobId, {
      cursor: String(result.nextCursor),
      successRows: job.successRows + result.succeeded,
      failedRows: job.failedRows + result.failed,
      status: result.done ? 'completed' : 'running',
      errorSummary: null,
      ...(filters ? { filters: filters as never } : {}),
    });
    return true;
  }

  /** Result for a chunk that an earlier attempt already committed. */
  replayed(job: ReportJobEntity): ChunkResult {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      nextCursor: Number(job.cursor ?? 0),
      done: job.status === 'completed',
    };
  }
}
