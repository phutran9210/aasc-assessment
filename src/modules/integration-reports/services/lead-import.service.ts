import { ConflictException, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OPERATION_KINDS } from '@core/queue/constants/operation.constants.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { normalizeLead } from '@modules/crm-integration/domain/normalize-lead.js';
import { AuditEventRepository } from '@modules/crm-integration/repositories/audit-event.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { LeadIdentityRepository } from '@modules/crm-integration/repositories/lead-identity.repository.js';
import { toProviderLead } from '@modules/crm-integration/services/lead-ingest.service.js';
import type { LeadIngestService } from '@modules/crm-integration/services/lead-ingest.service.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { LEAD_IMPORT_SCHEMA } from '../domain/import-parser.js';
import type { ImportRecord } from '../domain/import-parser.js';
import { buildLeadImportRow } from '../domain/lead-import-row.js';
import type { RowErrorInput } from '../repositories/report-row-error.repository.js';
import type { ReportJobDto } from '../types/report.types.js';
import { IMPORT_CHUNK_SIZE, ImportJobSupport } from './import-job.support.js';
import type { ChunkResult, UploadedImport } from './import-job.support.js';

export type ImportOptions = { dryRun: boolean; applyRules: boolean; sendFeedback: boolean };

export type LeadImportScope = {
  advertiserId: string;
  tiktokMode: 'mock' | 'business-api';
  defaultPhoneRegion: string;
};

type Preview = { create: number; merge: number; noop: number };
type RowOutcome = { error: RowErrorInput } | { preview?: keyof Preview };

@Injectable()
export class LeadImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly support: ImportJobSupport,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly ingest: Pick<LeadIngestService, 'process'> | null,
    private readonly configurations: ConfigurationRepository,
    private readonly identities: LeadIdentityRepository,
    private readonly audit: AuditEventRepository,
    private readonly scope: LeadImportScope,
  ) {}

  /**
   * Registers a historical lead file. The safe defaults are a dry run with rules and feedback off;
   * a live import is audited together with the options the operator chose.
   */
  start(
    file: UploadedImport,
    options: Partial<ImportOptions>,
    actor: Actor,
  ): Promise<ReportJobDto> {
    const resolved: ImportOptions = {
      dryRun: options.dryRun ?? true,
      applyRules: options.applyRules ?? false,
      sendFeedback: options.sendFeedback ?? false,
    };
    return this.support.register({
      file,
      schema: LEAD_IMPORT_SCHEMA,
      formats: ['csv', 'json'],
      filters: {
        type: 'leads',
        ...resolved,
        advertiserId: this.scope.advertiserId,
        providerMode: this.scope.tiktokMode,
      },
      operationKind: OPERATION_KINDS.historicalLeadImport,
      operationKey: (jobId) => `lead-import/${jobId}`,
      actor,
      beforeCommit: async (jobId, tx) => {
        if (resolved.dryRun) return;
        await this.audit.record(
          {
            id: uuidv7(),
            scopeKey: this.scope.advertiserId,
            actorId: actor.sub,
            eventType: 'import.leads.started',
            aggregateType: 'report_job',
            aggregateId: jobId,
            metadata: { ...resolved },
          },
          tx,
        );
      },
    });
  }

  /**
   * Processes one chunk of rows and then commits the cursor. Each live row commits on its own
   * through the regular ingest entry, which is idempotent per source record, so a crash before
   * the checkpoint only repeats rows that turn into no-ops.
   */
  async processChunk(
    jobId: string,
    cursor: number,
    limit = IMPORT_CHUNK_SIZE,
    context?: OperationContext,
  ): Promise<ChunkResult> {
    const { job, records } = await this.support.load(jobId, LEAD_IMPORT_SCHEMA);
    if (Number(job.cursor ?? 0) !== cursor || job.status === 'completed') {
      return this.support.replayed(job);
    }
    const options = job.filters as unknown as ImportOptions;
    const firstBySource = firstOccurrences(records);
    const ingestContext = context ?? (await this.standaloneContext(jobId));
    const now = new Date();

    const chunk = records.slice(cursor, cursor + limit);
    const errors: RowErrorInput[] = [];
    const preview: Preview = { create: 0, merge: 0, noop: 0 };
    for (const record of chunk) {
      const outcome = await this.processRow(record, firstBySource, options, ingestContext, now);
      if ('error' in outcome) errors.push(outcome.error);
      else if (outcome.preview) preview[outcome.preview] += 1;
    }

    const nextCursor = cursor + chunk.length;
    const result: ChunkResult = {
      processed: chunk.length,
      succeeded: chunk.length - errors.length,
      failed: errors.length,
      nextCursor,
      done: nextCursor >= records.length,
    };
    await this.support.recordErrors(jobId, errors);
    await this.dataSource.transaction((tx) => {
      const previous = (job.filters.preview ?? { create: 0, merge: 0, noop: 0 }) as Preview;
      const filters = options.dryRun
        ? {
            ...job.filters,
            preview: {
              create: previous.create + preview.create,
              merge: previous.merge + preview.merge,
              noop: previous.noop + preview.noop,
            },
          }
        : null;
      return this.support.checkpoint(jobId, cursor, result, filters, tx);
    });
    return result;
  }

  private async processRow(
    record: ImportRecord,
    firstBySource: Map<string, number>,
    options: ImportOptions,
    context: OperationContext,
    now: Date,
  ): Promise<RowOutcome> {
    const rowError = (errorCode: string, sourceKey: string | null, field?: string): RowOutcome => ({
      error: { rowNumber: record.rowNumber, sourceKey, errorCode, redactedDetail: field ?? null },
    });
    if (!record.values) return rowError(record.errorCode ?? 'ROW_MALFORMED', null);

    const row = buildLeadImportRow(record.values, this.scope.advertiserId, now);
    if (!row.ok) return rowError(row.errorCode, row.sourceKey, row.field);
    if (firstBySource.get(row.sourceRecordId) !== record.rowNumber) {
      return rowError('DUPLICATE_SOURCE_RECORD_ID', row.sourceRecordId, 'source_record_id');
    }

    const event = {
      provider: 'tiktok' as const,
      providerMode: this.scope.tiktokMode,
      scopeKey: this.scope.advertiserId,
      advertiserId: this.scope.advertiserId,
      eventKey: row.eventKey,
      eventType: 'lead.generate',
      occurredAt: row.occurredAt,
      payload: row.payload,
      payloadHash: row.payloadHash,
    };
    const normalized = normalizeLead(
      toProviderLead(
        { ...event, occurredAt: row.occurredAt },
        { applyRules: options.applyRules, sendFeedback: options.sendFeedback },
      ),
      this.scope.defaultPhoneRegion,
    );
    if (normalized.kind === 'quarantined') return rowError(normalized.reason, row.sourceRecordId);

    if (options.dryRun) {
      const existing = await this.dataSource.getRepository(WebhookEventEntity).findOne({
        where: {
          provider: event.provider,
          providerMode: event.providerMode,
          scopeKey: event.scopeKey,
          eventKey: event.eventKey,
        },
      });
      if (existing) {
        return existing.payloadHash === row.payloadHash
          ? { preview: 'noop' }
          : rowError('SOURCE_RECORD_CONTENT_CONFLICT', row.sourceRecordId);
      }
      const leadIds = new Set(
        (
          await this.identities.findByValues(
            this.scope.advertiserId,
            [
              ...(normalized.data.email
                ? [{ type: 'email' as const, value: normalized.data.email }]
                : []),
              ...(normalized.data.phone
                ? [{ type: 'phone' as const, value: normalized.data.phone }]
                : []),
            ],
            this.dataSource.manager,
          )
        ).map((identity) => identity.leadId),
      );
      if (leadIds.size > 1) return rowError('IDENTITY_CONFLICT', row.sourceRecordId);
      return { preview: leadIds.size === 1 ? 'merge' : 'create' };
    }

    // A dry run never needs the ingest pipeline, so the API process can preview without it.
    if (!this.ingest) throw new Error('Live lead imports are processed by the worker only');
    let eventId: string;
    try {
      ({ eventId } = await this.dataSource.transaction((tx) =>
        this.webhookEvents.accept(
          { ...event, rawBody: Buffer.from(JSON.stringify(row.payload), 'utf8') },
          tx,
        ),
      ));
    } catch (error) {
      if (error instanceof ConflictException) {
        return rowError('SOURCE_RECORD_CONTENT_CONFLICT', row.sourceRecordId);
      }
      throw error;
    }
    const outcome = await this.ingest.process(eventId, context, undefined, {
      applyRules: options.applyRules,
      sendFeedback: options.sendFeedback,
    });
    if (outcome.outcome === 'quarantined') {
      return rowError(
        outcome.errorCode === 'SUBMISSION_KEY_CONTENT_CONFLICT'
          ? 'SOURCE_RECORD_CONTENT_CONFLICT'
          : outcome.errorCode,
        row.sourceRecordId,
      );
    }
    return {};
  }

  private async standaloneContext(jobId: string): Promise<OperationContext> {
    const revisions = await this.configurations.revisions(this.dataSource.manager);
    return {
      operationId: jobId,
      ownerToken: jobId,
      attempt: 1,
      revisions: {
        mapping: revisions.mapping ?? 0,
        rules: revisions.rules ?? 0,
        scoring: revisions.scoring ?? 0,
      },
      signal: new AbortController().signal,
      assertOwnership: () => Promise.resolve(),
      acquireAggregateLease: () => Promise.resolve(null),
      releaseAggregateLease: () => Promise.resolve(true),
    };
  }
}

/** Row number of the first appearance of every source record id in the file. */
function firstOccurrences(records: ImportRecord[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const record of records) {
    const sourceRecordId = record.values?.source_record_id?.trim();
    if (sourceRecordId && !first.has(sourceRecordId)) first.set(sourceRecordId, record.rowNumber);
  }
  return first;
}
