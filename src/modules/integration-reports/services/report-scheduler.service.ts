import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { Temporal } from '@common/utils/temporal.util.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { ReportJobRepository } from '../repositories/report-job.repository.js';
import type { ExportScope } from '../types/report.types.js';

export const DAILY_REPORT_TYPE = 'daily-leads';
export const DAILY_REPORT_HOUR = 8;
export const DAILY_REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type ScheduleSummary = {
  reportType: string;
  /** Calendar day the report covers, in the schedule timezone. */
  period: string;
  created: boolean;
  jobId: string | null;
};

const ISO = { fractionalSecondDigits: 3 } as const;

/**
 * Creates the daily lead report once per period. The unique operation key
 * `scheduled-report/<policy revision>/<type>/<period>` in the operation ledger is the schedule
 * state: any number of workers may tick, and a tick after downtime creates the latest due report
 * exactly once instead of replaying every missed day.
 */
@Injectable()
export class ReportScheduler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jobs: ReportJobRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly configurations: ConfigurationRepository,
    private readonly scope: ExportScope,
  ) {}

  async tick(now: string): Promise<ScheduleSummary> {
    const local = Temporal.Instant.from(now).toZonedDateTimeISO(DAILY_REPORT_TIMEZONE);
    // Before 08:00 the run of the previous morning is the latest one that is due.
    const runDate =
      local.hour >= DAILY_REPORT_HOUR
        ? local.toPlainDate()
        : local.toPlainDate().subtract({ days: 1 });
    const period = runDate.subtract({ days: 1 });
    const from = period.toZonedDateTime(DAILY_REPORT_TIMEZONE).toInstant().toString(ISO);
    const to = runDate.toZonedDateTime(DAILY_REPORT_TIMEZONE).toInstant().toString(ISO);

    return this.dataSource.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        'integration-report-scheduler',
      ]);
      const policyRevision = (await this.configurations.revisions(tx)).reports ?? 0;
      const operationKey = `scheduled-report/${policyRevision}/${DAILY_REPORT_TYPE}/${period.toString()}`;
      const summary = { reportType: DAILY_REPORT_TYPE, period: period.toString() };
      const existing = await this.operations.findByKey(operationKey, tx);
      if (existing) return { ...summary, created: false, jobId: existing.aggregateId };

      const job = await this.jobs.create(
        {
          id: uuidv7(),
          kind: 'scheduled',
          requesterId: null,
          status: 'pending',
          filters: {
            format: 'csv',
            scope: 'leads',
            from,
            to,
            timezone: DAILY_REPORT_TIMEZONE,
            timeBasis: 'createdAt',
            providerMode: { tiktok: this.scope.tiktokMode, bitrix: this.scope.bitrixMode },
            campaignId: null,
            reportType: DAILY_REPORT_TYPE,
            period: period.toString(),
            policyRevision,
          } as never,
        },
        tx,
      );
      const operation = await this.operations.ensure(
        {
          operationKey,
          kind: OPERATION_KINDS.integrationReport,
          aggregateId: job.id,
          payload: { reportJobId: job.id },
        },
        tx,
      );
      await this.outbox.append(operation.id, QUEUE_NAMES.integrationReport, new Date(), tx);
      return { ...summary, created: true, jobId: job.id };
    });
  }
}
