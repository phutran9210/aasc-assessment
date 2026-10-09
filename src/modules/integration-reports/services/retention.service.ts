import { Injectable } from '@nestjs/common';
import { In, LessThan } from 'typeorm';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { FeedbackLedgerEntity } from '@modules/crm-integration/entities/feedback-ledger.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { NotificationEntity } from '../entities/notification.entity.js';
import { ReportJobEntity } from '../entities/report-job.entity.js';
import { ArtifactService } from './artifact.service.js';
import type { ArtifactArea } from './artifact.service.js';
import { NotificationService } from './notification.service.js';

export const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const RECORD_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const TEMP_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;

export type RetentionSummary = {
  rawEventsPurged: number;
  eventTombstonesDeleted: number;
  artifactsExpired: number;
  importFilesPurged: number;
  tempFilesRemoved: number;
  skippedArtifacts: number;
  auditEventsDeleted: number;
  operationsDeleted: number;
  notificationsDeleted: number;
  reportJobsDeleted: number;
};

// An event that still needs a human or a worker keeps its raw payload until it is settled.
const SETTLED_EVENT_STATUSES = ['processed', 'ignored'];
// Finished work only; pending, failed and reconcile-required operations are never purged.
const PURGEABLE_OPERATION_STATUSES = ['succeeded', 'cancelled'];
const FINISHED_JOB_STATUSES = ['completed', 'failed', 'expired'];
const BATCH = 500;

/**
 * Applies the retention policy: raw payloads 30 days, records 180 days, artifacts until they
 * expire. Purging a raw payload keeps the event row with its key and hash as the deduplication
 * tombstone, and nothing that is still pending or under investigation is removed.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly artifacts: ArtifactService,
    private readonly notifications: NotificationService,
  ) {}

  async run(now: string): Promise<RetentionSummary> {
    try {
      return await this.apply(new Date(now));
    } catch (error) {
      // A silent retention failure would let personal data outlive its policy: tell operators.
      await this.dataSource.transaction((tx) =>
        this.notifications.ensure(
          {
            dedupKey: `alert/retention_failed/${now.slice(0, 10)}`,
            type: 'alert.retention_failed',
            payload: { failedAt: now, error: error instanceof Error ? error.name : 'UnknownError' },
          },
          tx,
        ),
      );
      throw error;
    }
  }

  private async apply(now: Date): Promise<RetentionSummary> {
    const rawCutoff = new Date(now.getTime() - RAW_RETENTION_MS);
    const recordCutoff = new Date(now.getTime() - RECORD_RETENTION_MS);
    const manager = this.dataSource.manager;

    const purged = await manager
      .createQueryBuilder()
      .update(WebhookEventEntity)
      .set({ rawBody: Buffer.alloc(0), payload: { purged: true } })
      .where('received_at < :rawCutoff', { rawCutoff })
      .andWhere('status IN (:...statuses)', { statuses: SETTLED_EVENT_STATUSES })
      .andWhere('octet_length(raw_body) > 0')
      .execute();

    const referenced = manager
      .createQueryBuilder()
      .select('submission.event_id')
      .from(SubmissionEntity, 'submission')
      .getQuery();
    const tombstones = await manager
      .createQueryBuilder()
      .delete()
      .from(WebhookEventEntity)
      .where('received_at < :recordCutoff', { recordCutoff })
      .andWhere('status IN (:...statuses)', { statuses: SETTLED_EVENT_STATUSES })
      .andWhere(`id NOT IN (${referenced})`)
      .execute();

    const exportArtifacts = await this.releaseArtifacts(
      manager
        .getRepository(ReportJobEntity)
        .createQueryBuilder('job')
        .addSelect('job.artifactPath')
        .where(`job.kind IN ('export', 'scheduled')`)
        .andWhere('job.artifact_path IS NOT NULL')
        .andWhere('job.expires_at < :now', { now })
        .getMany(),
      'exports',
      'expired',
    );
    const importArtifacts = await this.releaseArtifacts(
      manager
        .getRepository(ReportJobEntity)
        .createQueryBuilder('job')
        .addSelect('job.artifactPath')
        .where(`job.kind = 'import'`)
        .andWhere('job.artifact_path IS NOT NULL')
        .andWhere('job.status IN (:...statuses)', { statuses: FINISHED_JOB_STATUSES })
        .andWhere('job.updated_at < :rawCutoff', { rawCutoff })
        .getMany(),
      'imports',
      null,
    );
    const tempFilesRemoved = await this.artifacts.sweepTemp(
      new Date(now.getTime() - TEMP_FILE_RETENTION_MS),
    );

    const audits = await manager
      .getRepository(AuditEventEntity)
      .delete({ createdAt: LessThan(recordCutoff) });
    const notifications = await manager
      .getRepository(NotificationEntity)
      .delete({ status: 'sent', createdAt: LessThan(recordCutoff) });
    const jobs = await manager
      .createQueryBuilder()
      .delete()
      .from(ReportJobEntity)
      .where('updated_at < :recordCutoff', { recordCutoff })
      .andWhere('status IN (:...statuses)', { statuses: FINISHED_JOB_STATUSES })
      .andWhere('artifact_path IS NULL')
      .execute();

    return {
      rawEventsPurged: purged.affected ?? 0,
      eventTombstonesDeleted: tombstones.affected ?? 0,
      artifactsExpired: exportArtifacts.released,
      importFilesPurged: importArtifacts.released,
      tempFilesRemoved,
      skippedArtifacts: exportArtifacts.skipped + importArtifacts.skipped,
      auditEventsDeleted: audits.affected ?? 0,
      operationsDeleted: await this.deleteFinishedOperations(recordCutoff),
      notificationsDeleted: notifications.affected ?? 0,
      reportJobsDeleted: jobs.affected ?? 0,
    };
  }

  private async releaseArtifacts(
    pending: Promise<ReportJobEntity[]>,
    area: ArtifactArea,
    status: string | null,
  ): Promise<{ released: number; skipped: number }> {
    let released = 0;
    let skipped = 0;
    for (const job of await pending) {
      if ((await this.artifacts.removeJobDirectory(job.id, area)) === 'skipped') {
        skipped += 1;
        continue;
      }
      await this.dataSource
        .getRepository(ReportJobEntity)
        .update(job.id, { artifactPath: null, ...(status ? { status } : {}) });
      released += 1;
    }
    return { released, skipped };
  }

  /** Deletes finished operations in batches together with their outbox rows. */
  private async deleteFinishedOperations(cutoff: Date): Promise<number> {
    const ledgerReferences = this.dataSource.manager
      .createQueryBuilder()
      .select('ledger.operation_id')
      .from(FeedbackLedgerEntity, 'ledger')
      .where('ledger.operation_id IS NOT NULL')
      .getQuery();
    let deleted = 0;
    for (;;) {
      const rows = await this.dataSource
        .getRepository(OperationEntity)
        .createQueryBuilder('operation')
        .select('operation.id', 'id')
        .where('operation.updated_at < :cutoff', { cutoff })
        .andWhere('operation.status IN (:...statuses)', { statuses: PURGEABLE_OPERATION_STATUSES })
        .andWhere(`operation.id NOT IN (${ledgerReferences})`)
        .limit(BATCH)
        .getRawMany<{ id: string }>();
      if (!rows.length) return deleted;
      const ids = rows.map((row) => row.id);
      await this.dataSource.transaction(async (tx) => {
        await tx.getRepository(OutboxEntity).delete({ operationId: In(ids) });
        await tx.getRepository(OperationEntity).delete({ id: In(ids) });
      });
      deleted += ids.length;
    }
  }
}
