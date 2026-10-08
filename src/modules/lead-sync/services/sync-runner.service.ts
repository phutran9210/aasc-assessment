import { backoffDelayMs, nowMs, sleep } from '@common/utils/index.js';
import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';
import { BitrixHttpError, isTransientBitrixError } from '@modules/bitrix/index.js';
import { SheetsError } from '@modules/google-sheets/index.js';

import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';

import {
  BITRIX_TIME_LIMIT_CODE,
  BITRIX_TRANSIENT_CODES,
  HASH_KIND,
  HEARTBEAT_INTERVAL_MS,
  LEAD_SYNC_RUN_STATUS,
  SHEET_COLUMNS,
  SPECIAL_FIELDS,
  SYNC_STATUS,
} from '../constants/index.js';
import type { LeadSyncRunStatus, LeadSyncTrigger } from '../constants/index.js';
import { chunk } from '../domain/chunk.js';
import { checkMapping } from '../domain/mapping-schema.js';
import { transformRow } from '../domain/row-transformer.js';
import { formatHashCell } from '../domain/sync-hash.js';
import {
  buildDuplicateQueries,
  classifyRows,
  planBatch,
  toMatches,
} from '../domain/sync-planner.js';
import { formatTimestamp } from '../domain/timestamp.js';
import type { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { describeError } from '../errors/describe-error.js';
import { LeadSyncBusyError, LeadSyncConfigError, LeadSyncMappingError } from '../errors/index.js';
import { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { LeadSyncRunItemRepository } from '../repositories/lead-sync-run-item.repository.js';
import { LeadSyncRunRepository } from '../repositories/lead-sync-run.repository.js';
import type {
  LeadMapping,
  LeadWriteOp,
  LeadWriteResult,
  PendingRow,
  RowFailure,
  RunCounters,
  RunItemInput,
  SheetRow,
} from '../types/index.js';
import { LeadSyncReadiness } from './lead-sync-readiness.service.js';
import { MappingLoader } from './mapping-loader.service.js';
import { SheetTable } from './sheet-table.service.js';
import type { RowWrite, SheetSnapshot } from './sheet-table.service.js';

export type RunOptions = { trigger: LeadSyncTrigger; dryRun?: boolean; force?: boolean };

/** `done` resolves with the finished run and never rejects. */
export type StartedRun = { run: LeadSyncRun; done: Promise<LeadSyncRun> };

type RunContext = {
  runId: string;
  dryRun: boolean;
  snapshot: SheetSnapshot;
  /** Columns holding email and phone: re-read before every write to detect moved rows. */
  keyColumns: string[];
  counters: RunCounters;
};

type PreparedBatch = { ops: LeadWriteOp[]; failures: RowFailure[] };

const { SUCCEEDED, PARTIAL, FAILED, ABORTED } = LEAD_SYNC_RUN_STATUS;
const { ERROR: MESSAGES, ROW } = LEAD_SYNC_MESSAGES;
/** Enough to tell an email from a name; the portal decides whether it exists. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Rows per Sheet write when reporting failures outside a batch (a sheet full of bad rows).
const FAILURE_WRITE_CHUNK = 100;

/**
 * Orchestrates one sync run: takes the lock, reads the Sheet, splits the work into batches and,
 * per batch, searches duplicates → writes to Bitrix24 → writes results back to the Sheet. Holds
 * no mapping or HTTP logic of its own; those live in the pure domain functions and the gateways.
 */
@Injectable()
export class SyncRunner implements BeforeApplicationShutdown {
  private readonly logger = new Logger(SyncRunner.name);
  private stopRequested = false;
  private active: Promise<LeadSyncRun> | undefined;

  constructor(
    private readonly runs: LeadSyncRunRepository,
    private readonly items: LeadSyncRunItemRepository,
    private readonly readiness: LeadSyncReadiness,
    private readonly mappingLoader: MappingLoader,
    private readonly table: SheetTable,
    private readonly gateway: BitrixLeadGateway,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  /**
   * Starts a run in the background and returns as soon as it holds the lock.
   * Throws LeadSyncConfigError when the integration is not configured and LeadSyncBusyError when
   * another run (of this or another process) is in progress.
   */
  async start(options: RunOptions): Promise<StartedRun> {
    const missing = await this.readiness.missing();
    if (missing) throw new LeadSyncConfigError(missing);

    const dryRun = options.dryRun ?? false;
    const run = await this.runs.acquire(options.trigger, dryRun, this.config.lockStaleMs);
    if (!run) {
      const running = await this.runs.findRunning();
      throw new LeadSyncBusyError(running?.id ?? null);
    }

    this.stopRequested = false;
    const done = this.execute(run, options).finally(() => {
      this.active = undefined;
    });
    this.active = done;
    return { run, done };
  }

  /**
   * An assignee cell may hold the email of a portal user that the mapping does not list. Those
   * emails are looked up once per run and added to the value table of the column, in memory
   * only. When the lookup is refused (no `user` scope) the default assignee is used, as before.
   */
  private async withPortalUsers(
    mapping: LeadMapping,
    rows: readonly SheetRow[],
  ): Promise<LeadMapping> {
    const userFields = mapping.fields.filter((field) => field.type === 'user');
    const unknown = new Set<string>();
    for (const field of userFields) {
      const known = new Set(Object.keys(field.values ?? {}).map((label) => label.toLowerCase()));
      for (const row of rows) {
        const label = (row.cells[field.column]?.formatted ?? '').trim().toLowerCase();
        if (EMAIL_SHAPE.test(label) && !known.has(label)) unknown.add(label);
      }
    }
    if (!unknown.size) return mapping;

    let users: Map<string, number>;
    try {
      users = await this.gateway.findUsersByEmail([...unknown]);
    } catch (error) {
      this.logger.warn(
        `Assignees not looked up with user.get (${describeError(error)}); using the default assignee`,
      );
      return mapping;
    }
    if (!users.size) return mapping;
    return {
      ...mapping,
      fields: mapping.fields.map((field) =>
        field.type === 'user'
          ? { ...field, values: { ...Object.fromEntries(users), ...field.values } }
          : field,
      ),
    };
  }

  /** SIGTERM/SIGINT: let the current batch finish, then stop the run as `aborted`. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopRequested = true;
    await this.active;
  }

  private async execute(run: LeadSyncRun, options: RunOptions): Promise<LeadSyncRun> {
    const startedAt = nowMs();
    const counters: RunCounters = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    let status: LeadSyncRunStatus;
    let stopReason: string | null;

    this.logger.log(
      `Lead sync ${run.id} started: trigger=${options.trigger} dryRun=${options.dryRun ?? false} force=${options.force ?? false}`,
    );
    // A long batch (backoff, a slow Bitrix24) must not look like a dead run to other processes.
    const heartbeat = setInterval(() => {
      void this.runs.touch(run.id).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    try {
      stopReason = await this.process(run, options, counters);
      if (stopReason) status = ABORTED;
      else status = counters.failed > 0 ? PARTIAL : SUCCEEDED;
    } catch (error) {
      status = FAILED;
      stopReason = describeError(error);
      this.logger.error(`Lead sync ${run.id} failed: ${stopReason}`);
    } finally {
      clearInterval(heartbeat);
    }

    let finished: LeadSyncRun;
    try {
      finished = await this.runs.finish(run.id, status, counters, stopReason);
    } catch (error) {
      // `done` must never reject: the HTTP trigger does not await it. The row stays `running`
      // until its heartbeat goes stale and the next run takes the lock over.
      stopReason = describeError(error);
      this.logger.error(`Lead sync ${run.id} could not be closed: ${stopReason}`);
      finished = Object.assign(run, counters, { status: FAILED, stopReason });
    }
    const seconds = ((nowMs() - startedAt) / 1000).toFixed(1);
    this.logger.log(
      `Lead sync ${run.id} finished: total=${counters.total} created=${counters.created} updated=${counters.updated} skipped=${counters.skipped} failed=${counters.failed} duration=${seconds}s`,
    );
    return finished;
  }

  /** Runs the whole flow of §6.1. Returns the reason when the run stopped early, else null. */
  private async process(
    run: LeadSyncRun,
    options: RunOptions,
    counters: RunCounters,
  ): Promise<string | null> {
    const dryRun = options.dryRun ?? false;
    await this.purgeOldRuns();

    const { mapping, hash: mappingHash } = await this.mappingLoader.load();
    const snapshot = await this.table.load(mapping);
    if (!(await this.gateway.usesLeads())) {
      throw new LeadSyncConfigError(MESSAGES.SIMPLE_CRM_MODE);
    }
    const leadFields = await this.gateway.getFieldNames();
    const problems = checkMapping(mapping, snapshot.headers, leadFields);
    if (problems.length) throw new LeadSyncMappingError(problems);
    // Only now is the Sheet touched: a wrong mapping must leave it exactly as it was.
    if (!dryRun) await this.table.ensureTechnicalColumns(snapshot);

    const transformContext = {
      mapping: await this.withPortalUsers(mapping, snapshot.rows),
      mappingHash,
      defaultCountry: this.config.defaultCountry,
      timezone: this.config.timezone,
    };
    const transformed = snapshot.rows.map((row) => transformRow(row, transformContext));
    const states = new Map(snapshot.rows.map((row) => [row.rowNumber, row.state]));
    const classification = classifyRows(transformed, states, { force: options.force ?? false });

    counters.total = transformed.filter((row) => row.kind !== 'empty').length;
    counters.skipped = classification.skipped;
    const context: RunContext = {
      runId: run.id,
      dryRun,
      snapshot,
      counters,
      keyColumns: mapping.fields
        .filter((field) => SPECIAL_FIELDS.includes(field.field))
        .map((field) => field.column),
    };

    await this.recordFailures(context, classification.failures, 'validate');
    await this.runs.heartbeat(run.id, counters);

    const batches = chunk(classification.pending, this.config.batchSize);
    for (const [index, batch] of batches.entries()) {
      if (this.stopRequested) {
        return this.abort(context, batches.slice(index), MESSAGES.STOPPED_BY_SIGNAL);
      }
      try {
        await this.processBatch(context, batch, classification.owners);
      } catch (error) {
        if (isTimeLimit(error))
          return this.abort(context, batches.slice(index), MESSAGES.TIME_LIMIT);
        // Anything that is not known to be temporary ends the run: wrong credentials, a Sheet
        // that is no longer shared, a bug. Carrying on would only repeat it for every batch.
        if (!isTemporary(error)) throw error;
        const failures = batch.map(({ row }) => ({
          rowNumber: row.rowNumber,
          code: codeOf(error),
          message: ROW.TRANSIENT(describeError(error)),
        }));
        await this.recordFailures(context, failures, 'batch');
      }
      await this.runs.heartbeat(run.id, counters);
      this.logger.log(
        `Lead sync ${run.id} batch ${index + 1}/${batches.length}: created=${counters.created} updated=${counters.updated} failed=${counters.failed}`,
      );
    }
    return null;
  }

  /**
   * One batch: plan, write to Bitrix24, write results to the Sheet. When the write call fails
   * temporarily it is NOT sent again as is: Bitrix24 may have executed it. The batch goes back
   * to the duplicate search instead, so a lead that was created is found and becomes an update.
   */
  private async processBatch(
    context: RunContext,
    batch: PendingRow[],
    owners: Map<number, number>,
  ): Promise<void> {
    const { counters, dryRun } = context;
    let prepared: PreparedBatch;
    let results = new Map<number, LeadWriteResult>();
    let attempts = 0;

    for (;;) {
      attempts += 1;
      prepared = await this.prepare(context, batch, owners);
      if (dryRun) break;
      try {
        results = await this.gateway.write(prepared.ops);
        break;
      } catch (error) {
        if (!isTransientBitrixError(error) || attempts > this.config.maxRetries) throw error;
        // The backoff also gives the duplicate index of Bitrix24 time to catch up.
        const delayMs = backoffDelayMs(attempts - 1, this.config.retryBaseDelayMs);
        this.logger.warn(
          `Lead sync ${context.runId}: write batch failed (${describeError(error)}), searching duplicates again in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }

    const failures: RowFailure[] = [...prepared.failures];
    if (dryRun) {
      for (const op of prepared.ops) counters[op.action === 'create' ? 'created' : 'updated'] += 1;
      await this.recordFailures(context, failures, 'plan');
      return;
    }

    const syncedAt = formatTimestamp(this.config.timezone);
    const succeeded: { op: LeadWriteOp; leadId: number }[] = [];
    const writes: RowWrite[] = [];
    for (const op of prepared.ops) {
      const result = results.get(op.row.rowNumber);
      if (!result?.ok) {
        failures.push(toWriteFailure(op, result));
        continue;
      }
      succeeded.push({ op, leadId: result.leadId });
      writes.push({
        rowNumber: op.row.rowNumber,
        cells: {
          [SHEET_COLUMNS.LEAD_ID]: String(result.leadId),
          [SHEET_COLUMNS.STATUS]: SYNC_STATUS.SYNCED,
          [SHEET_COLUMNS.SYNCED_AT]: syncedAt,
          [SHEET_COLUMNS.ERROR]: '',
          [SHEET_COLUMNS.HASH]: formatHashCell(HASH_KIND.SYNCED, op.row.hash),
        },
      });
    }

    // Counted only after the Sheet accepted the result: if this write fails, the whole batch is
    // reported as a temporary failure and the next run links the rows through duplicate search.
    const outcome = await this.table.writeResults(context.snapshot, writes, context.keyColumns);
    const items: RunItemInput[] = [];
    for (const { op, leadId } of succeeded) {
      const { rowNumber } = op.row;
      if (outcome.drifted.includes(rowNumber)) {
        failures.push({ rowNumber, code: 'ROW_MOVED', message: ROW.ROW_MOVED, skipSheet: true });
        continue;
      }
      counters[op.action === 'create' ? 'created' : 'updated'] += 1;
      items.push({ rowNumber, action: op.action, leadId, attempts });
    }
    await this.items.addMany(context.runId, items);
    await this.recordFailures(context, failures, 'write', attempts);
  }

  /** Duplicate search → plan → read the leads that will be updated (their multifield ids). */
  private async prepare(
    context: RunContext,
    batch: PendingRow[],
    owners: Map<number, number>,
  ): Promise<PreparedBatch> {
    const found = await this.gateway.findDuplicates(buildDuplicateQueries(batch));
    const plan = planBatch(batch, toMatches(batch, found), owners);
    const linkedRows = new Set(
      batch.filter((item) => item.leadId !== undefined).map((item) => item.row.rowNumber),
    );
    const leadIds = plan.ops.flatMap((op) => (op.leadId === undefined ? [] : [op.leadId]));
    const leads = await this.gateway.getLeads(leadIds);

    const prepared: PreparedBatch = { ops: [], failures: [...plan.failures] };
    for (const op of plan.ops) {
      const { rowNumber } = op.row;
      if (op.otherMatches.length) {
        this.logger.warn(
          `Lead sync ${context.runId} row ${rowNumber}: several leads match, using ${op.leadId}, others: ${op.otherMatches.join(', ')}`,
        );
      }
      if (op.leadId === undefined) {
        prepared.ops.push(op);
        continue;
      }
      const current = leads.get(op.leadId);
      if (current) {
        prepared.ops.push({ ...op, current });
      } else if (linkedRows.has(rowNumber)) {
        // The Sheet points at a lead that is gone. Deleting is usually deliberate: do not
        // create it again behind the admin's back.
        prepared.failures.push({ rowNumber, code: 'LEAD_DELETED', message: ROW.LEAD_DELETED });
      } else {
        prepared.failures.push({
          rowNumber,
          code: 'LEAD_UNREADABLE',
          message: ROW.LEAD_UNREADABLE,
        });
      }
    }
    return prepared;
  }

  /** Counts, logs and stores failed rows, and shows them in the Sheet (`Lỗi` + reason). */
  private async recordFailures(
    context: RunContext,
    failures: RowFailure[],
    step: string,
    attempts = 1,
  ): Promise<void> {
    if (!failures.length) return;
    context.counters.failed += failures.length;
    for (const failure of failures) {
      this.logger.error(
        `Lead sync ${context.runId} row ${failure.rowNumber} failed at ${step}: code=${failure.code} message=${failure.message}`,
      );
    }
    if (context.dryRun) return;

    await this.items.addMany(
      context.runId,
      failures.map((failure) => ({
        rowNumber: failure.rowNumber,
        action: 'fail',
        errorCode: failure.code,
        errorMessage: failure.message,
        attempts,
      })),
    );
    const writes = failures
      .filter((failure) => !failure.unchanged && !failure.skipSheet)
      .map((failure) => ({
        rowNumber: failure.rowNumber,
        cells: {
          [SHEET_COLUMNS.STATUS]: SYNC_STATUS.ERROR,
          [SHEET_COLUMNS.ERROR]: failure.message,
          ...(failure.hashCell ? { [SHEET_COLUMNS.HASH]: failure.hashCell } : {}),
        },
      }));
    await this.writeStatus(context, writes);
  }

  /** Stops early: the rows not reached yet are marked `Chờ xử lý` for the next run. */
  private async abort(
    context: RunContext,
    remaining: PendingRow[][],
    reason: string,
  ): Promise<string> {
    if (!context.dryRun) {
      const writes = remaining.flat().map(({ row }) => ({
        rowNumber: row.rowNumber,
        cells: { [SHEET_COLUMNS.STATUS]: SYNC_STATUS.PENDING },
      }));
      await this.writeStatus(context, writes);
    }
    return reason;
  }

  /**
   * Status-only writes. A temporary Sheets failure here is logged and swallowed: the rows keep
   * their old state and are simply picked up again by the next run.
   */
  private async writeStatus(context: RunContext, writes: RowWrite[]): Promise<void> {
    for (const group of chunk(writes, FAILURE_WRITE_CHUNK)) {
      try {
        await this.table.writeResults(context.snapshot, group, context.keyColumns);
      } catch (error) {
        if (!(error instanceof SheetsError) || !error.retryable) throw error;
        this.logger.warn(
          `Lead sync ${context.runId}: could not write ${group.length} status rows (${error.kind})`,
        );
      }
    }
  }

  private async purgeOldRuns(): Promise<void> {
    const expired = await this.runs.findExpiredIds(this.config.logRetentionDays);
    await this.items.deleteByRunIds(expired);
    await this.runs.deleteByIds(expired);
  }
}

/** A failure the next run can get past by itself: the batch fails, the run continues. */
function isTemporary(error: unknown): boolean {
  if (error instanceof BitrixHttpError) return isTransientBitrixError(error);
  if (error instanceof SheetsError) return error.retryable;
  // 429 raised by the client-side Bitrix24 rate limiter when its queue is too long.
  if (error instanceof HttpException)
    return error.getStatus() === Number(HttpStatus.TOO_MANY_REQUESTS);
  return false;
}

function isTimeLimit(error: unknown): boolean {
  return error instanceof BitrixHttpError && error.code === BITRIX_TIME_LIMIT_CODE;
}

function codeOf(error: unknown): string {
  if (error instanceof BitrixHttpError)
    return error.code ?? (error.timeout ? 'TIMEOUT' : 'NETWORK');
  if (error instanceof SheetsError) return `SHEETS_${error.kind.toUpperCase()}`;
  if (error instanceof HttpException) return `HTTP_${error.getStatus()}`;
  return 'UNKNOWN';
}

/** Outcome of one failed batch command, as a row failure. */
function toWriteFailure(op: LeadWriteOp, result: LeadWriteResult | undefined): RowFailure {
  const { rowNumber, hash } = op.row;
  const code = result && !result.ok ? result.code : 'NO_RESULT';
  const reason = result && !result.ok ? result.message : code;

  if (code === 'NOT_FOUND') return { rowNumber, code, message: ROW.LEAD_DELETED };
  const retryLater =
    BITRIX_TRANSIENT_CODES.includes(code) ||
    code === BITRIX_TIME_LIMIT_CODE ||
    code === 'ID_MISSING';
  if (retryLater) return { rowNumber, code, message: ROW.TRANSIENT(reason) };
  // Bitrix24 refused the values: remember the hash so the row is not sent again as is.
  return {
    rowNumber,
    code,
    message: ROW.REJECTED(reason),
    hashCell: formatHashCell(HASH_KIND.INVALID, hash),
  };
}
