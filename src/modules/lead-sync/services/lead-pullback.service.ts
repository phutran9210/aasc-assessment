import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { LEAD_SYNC_RUN_STATUS, SHEET_COLUMNS, SPECIAL_FIELDS } from '../constants/index.js';
import type { LeadSyncTrigger } from '../constants/index.js';
import { planPullback } from '../domain/pullback.js';
import { formatTimestamp } from '../domain/timestamp.js';
import type { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { describeError } from '../errors/describe-error.js';
import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { LeadSyncRunRepository } from '../repositories/lead-sync-run.repository.js';
import type { RunCounters } from '../types/index.js';
import { LeadSyncReadiness } from './lead-sync-readiness.service.js';
import { MappingLoader } from './mapping-loader.service.js';
import { SheetTable } from './sheet-table.service.js';
import type { StartedRun } from './sync-runner.service.js';

const { SUCCEEDED, FAILED } = LEAD_SYNC_RUN_STATUS;

/**
 * Bitrix24 → Sheet half of the two-way sync: copies the stage and the assignee of leads back to
 * the rows linked to them. It takes the same single-run lock as SyncRunner, so the two never
 * touch the Sheet at the same time, and it shows up in the same run log.
 */
@Injectable()
export class LeadPullback {
  private readonly logger = new Logger(LeadPullback.name);

  constructor(
    private readonly runs: LeadSyncRunRepository,
    private readonly readiness: LeadSyncReadiness,
    private readonly mappingLoader: MappingLoader,
    private readonly table: SheetTable,
    private readonly gateway: BitrixLeadGateway,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  get enabled(): boolean {
    return this.config.direction === 'two-way';
  }

  /**
   * Starts pulling the given leads (or every linked lead) in the background.
   * Throws LeadSyncConfigError when two-way sync is off or the integration is not configured,
   * and LeadSyncBusyError when another run is in progress.
   */
  async start(leadIds: number[] | 'all', trigger: LeadSyncTrigger): Promise<StartedRun> {
    if (!this.enabled) throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.TWO_WAY_OFF);
    const missing = await this.readiness.missing();
    if (missing) throw new LeadSyncConfigError(missing);

    const run = await this.runs.acquire(trigger, false, this.config.lockStaleMs);
    if (!run) {
      const running = await this.runs.findRunning();
      throw new LeadSyncBusyError(running?.id ?? null);
    }
    return { run, done: this.execute(run, leadIds) };
  }

  private async execute(run: LeadSyncRun, leadIds: number[] | 'all'): Promise<LeadSyncRun> {
    const counters: RunCounters = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    let conflicts = 0;
    let stopReason: string | null = null;
    try {
      conflicts = await this.pull(leadIds, counters);
    } catch (error) {
      stopReason = describeError(error);
      this.logger.error(`Lead pullback ${run.id} failed: ${stopReason}`);
    }

    try {
      const finished = await this.runs.finish(
        run.id,
        stopReason ? FAILED : SUCCEEDED,
        counters,
        stopReason,
      );
      this.logger.log(
        `Lead pullback ${run.id} finished: total=${counters.total} updated=${counters.updated} skipped=${counters.skipped} conflicts=${conflicts}`,
      );
      return finished;
    } catch (error) {
      // `done` must never reject: its callers do not always await it.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Lead pullback ${run.id} could not be closed: ${reason}`);
      return Object.assign(run, counters, { status: FAILED, stopReason: reason });
    }
  }

  /** Returns the number of rows left alone because the Sheet had a newer edit. */
  private async pull(leadIds: number[] | 'all', counters: RunCounters): Promise<number> {
    const { mapping, hash: mappingHash } = await this.mappingLoader.load();
    const snapshot = await this.table.load(mapping);

    const wanted = leadIds === 'all' ? null : new Set(leadIds);
    const rows = snapshot.rows.filter((row) => {
      if (!/^\d+$/.test(row.state.leadId)) return false;
      return !wanted || wanted.has(Number(row.state.leadId));
    });
    if (!rows.length) return 0;

    const leads = await this.gateway.getLeads(rows.map((row) => Number(row.state.leadId)));
    const plan = planPullback(rows, leads, {
      mapping,
      mappingHash,
      defaultCountry: this.config.defaultCountry,
      timezone: this.config.timezone,
    });

    const syncedAt = formatTimestamp(this.config.timezone);
    const outcome = await this.table.writeResults(
      snapshot,
      plan.writes.map((write) => ({
        rowNumber: write.rowNumber,
        cells: {
          ...write.cells,
          [SHEET_COLUMNS.HASH]: write.hash,
          [SHEET_COLUMNS.SYNCED_AT]: syncedAt,
        },
      })),
      mapping.fields
        .filter((field) => SPECIAL_FIELDS.includes(field.field))
        .map((field) => field.column),
    );

    counters.total = plan.writes.length + plan.conflicts.length + plan.unchanged.length;
    counters.updated = outcome.written.length;
    counters.skipped = counters.total - counters.updated;
    return plan.conflicts.length;
  }
}
