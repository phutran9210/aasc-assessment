import { nowDate, nowMs, toSkip } from '@common/utils/index.js';
import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, Not } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { ERROR_MESSAGE_MAX_LENGTH, LEAD_SYNC_RUN_STATUS } from '../constants/index.js';
import type { LeadSyncRunStatus, LeadSyncTrigger } from '../constants/index.js';
import { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type { RunCounters } from '../types/index.js';

const { RUNNING, ABORTED } = LEAD_SYNC_RUN_STATUS;
const DAY_MS = 86_400_000;

@Injectable()
export class LeadSyncRunRepository extends BaseRepository<LeadSyncRun> {
  constructor(dataSource: DataSource) {
    super(dataSource, LeadSyncRun);
  }

  /**
   * Starts a run if no other one is running. Two atomic statements make this safe for the
   * schedule, HTTP and the CLI process firing together: an UPDATE that retires a running row
   * whose owner went silent for `staleMs`, then an INSERT that does nothing when a running row
   * still exists (unique index on status = 'running'). Returns null when the lock is taken.
   */
  async acquire(
    trigger: LeadSyncTrigger,
    dryRun: boolean,
    staleMs: number,
  ): Promise<LeadSyncRun | null> {
    const now = nowMs();

    await this.repo
      .createQueryBuilder()
      .update()
      .set({ status: ABORTED, stopReason: LEAD_SYNC_MESSAGES.ERROR.STALE, finishedAt: nowDate() })
      .where('status = :running AND heartbeatAt <= :staleBefore', {
        running: RUNNING,
        staleBefore: now - staleMs,
      })
      .execute();

    const id = uuidv7();
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ id, trigger, dryRun, status: RUNNING, startedAt: nowDate(), heartbeatAt: now })
      .orIgnore()
      .execute();

    return this.findById(id);
  }

  findRunning(): Promise<LeadSyncRun | null> {
    return this.repo.findOne({ where: { status: RUNNING } });
  }

  async findLatest(): Promise<LeadSyncRun | null> {
    const [latest] = await this.repo.find({ order: { startedAt: 'DESC', id: 'DESC' }, take: 1 });
    return latest ?? null;
  }

  /** Sign of life between batches, so a long batch does not look like a dead run. */
  async touch(id: string): Promise<void> {
    await this.repo.update({ id, status: RUNNING }, { heartbeatAt: nowMs() });
  }

  /** Progress after each batch: counters and a fresh heartbeat. */
  async heartbeat(id: string, counters: RunCounters): Promise<void> {
    await this.repo.update({ id }, { ...counters, heartbeatAt: nowMs() });
  }

  /**
   * Ends the run and releases the lock. Only a run that is still `running` is closed: one that
   * a later run took over stays `aborted`, even if its process was alive after all and now
   * reports its own outcome.
   */
  async finish(
    id: string,
    status: LeadSyncRunStatus,
    counters: RunCounters,
    stopReason: string | null,
  ): Promise<LeadSyncRun> {
    await this.repo.update(
      { id, status: RUNNING },
      {
        ...counters,
        status,
        stopReason: stopReason?.slice(0, ERROR_MESSAGE_MAX_LENGTH) ?? null,
        finishedAt: nowDate(),
      },
    );
    return this.repo.findOneByOrFail({ id });
  }

  list(page: number, limit: number): Promise<[LeadSyncRun[], number]> {
    return this.repo.findAndCount({
      order: { startedAt: 'DESC', id: 'DESC' },
      skip: toSkip(page, limit),
      take: limit,
    });
  }

  /** Finished runs that started more than `days` days ago. */
  async findExpiredIds(days: number): Promise<string[]> {
    const expired = await this.repo.find({
      select: { id: true },
      where: { startedAt: LessThan(new Date(nowMs() - days * DAY_MS)), status: Not(RUNNING) },
    });
    return expired.map((run) => run.id);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length) await this.repo.delete({ id: In(ids) });
  }
}
