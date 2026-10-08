import type { PaginatedResponse } from '@common/types/index.js';
import { buildPaginationMeta } from '@common/utils/index.js';
import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';
import { SheetsClient } from '@modules/google-sheets/index.js';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { LeadSyncRunItemRepository } from '../repositories/lead-sync-run-item.repository.js';
import { LeadSyncRunRepository } from '../repositories/lead-sync-run.repository.js';
import type {
  ConnectionCheck,
  LeadSyncStatusResponse,
  RunDetailResponse,
  RunResponse,
} from '../types/index.js';
import { LeadSyncReadiness } from './lead-sync-readiness.service.js';
import { SyncScheduler } from './sync-scheduler.service.js';

/** Read side of the integration: the run log and a health overview for the admin. */
@Injectable()
export class LeadSyncStatusService {
  constructor(
    private readonly runs: LeadSyncRunRepository,
    private readonly items: LeadSyncRunItemRepository,
    private readonly readiness: LeadSyncReadiness,
    private readonly scheduler: SyncScheduler,
    private readonly sheets: SheetsClient,
    private readonly gateway: BitrixLeadGateway,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  async listRuns(page: number, limit: number): Promise<PaginatedResponse<RunResponse>> {
    const [runs, total] = await this.runs.list(page, limit);
    return { data: runs.map(toRunResponse), meta: buildPaginationMeta(total, page, limit) };
  }

  /** One run with the rows it created, updated or failed. */
  async getRun(id: string): Promise<RunDetailResponse> {
    const run = await this.runs.findById(id);
    if (!run) throw new NotFoundException(LEAD_SYNC_MESSAGES.ERROR.RUN_NOT_FOUND);

    const items = await this.items.findByRun(id);
    return {
      ...toRunResponse(run),
      items: items.map((item) => ({
        rowNumber: item.rowNumber,
        action: item.action,
        leadId: item.leadId,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        attempts: item.attempts,
      })),
    };
  }

  /** Schedule, last run and a live check of both connections (one cheap call each). */
  async getStatus(): Promise<LeadSyncStatusResponse> {
    const reason = await this.readiness.missing();
    const unavailable: ConnectionCheck = { ok: false, message: reason };
    const latest = await this.runs.findLatest();

    return {
      configured: reason === null,
      reason,
      schedule: {
        cron: this.config.cron ?? null,
        timezone: this.config.timezone,
        nextRunAt: this.scheduler.nextRunAt(),
      },
      lastRun: latest ? toRunResponse(latest) : null,
      connections: {
        google: reason ? unavailable : await check(() => this.sheets.getSheetMeta()),
        bitrix: reason ? unavailable : await check(() => this.gateway.getFieldNames()),
      },
    };
  }
}

async function check(call: () => Promise<unknown>): Promise<ConnectionCheck> {
  try {
    await call();
    return { ok: true, message: null };
  } catch (error) {
    // Messages of SheetsError and BitrixHttpError never carry credentials or URLs.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function toRunResponse(run: LeadSyncRun): RunResponse {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    dryRun: run.dryRun,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    total: run.total,
    created: run.created,
    updated: run.updated,
    skipped: run.skipped,
    failed: run.failed,
    stopReason: run.stopReason,
  };
}
