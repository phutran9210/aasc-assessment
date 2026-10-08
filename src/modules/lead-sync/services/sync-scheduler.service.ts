import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CronJob } from 'cron';

import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { SyncRunner } from './sync-runner.service.js';

export const LEAD_SYNC_JOB = 'lead-sync';

/**
 * Runs the sync on the cron expression of LEAD_SYNC_CRON. Nothing is scheduled until `start()`
 * is called, and only `main.ts` calls it: the CLI boots the same AppModule and must not start
 * a schedule of its own.
 */
@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly runner: SyncRunner,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  /** Registers and starts the cron job. Returns false when no schedule is configured. */
  start(): boolean {
    const { cron, timezone } = this.config;
    if (!cron) return false;
    if (this.registry.doesExist('cron', LEAD_SYNC_JOB)) return true;

    const job = CronJob.from({
      cronTime: cron,
      timeZone: timezone,
      start: false,
      onTick: () => {
        void this.tick();
      },
    });
    this.registry.addCronJob(LEAD_SYNC_JOB, job);
    job.start();
    this.logger.log(`Lead sync scheduled: "${cron}" (${timezone})`);
    return true;
  }

  /** One beat of the schedule. A beat that cannot run is skipped, never queued. */
  async tick(): Promise<void> {
    try {
      const { done } = await this.runner.start({ trigger: 'schedule' });
      await done;
    } catch (error) {
      if (error instanceof LeadSyncBusyError) {
        this.logger.warn('Lead sync tick skipped: the previous run is still in progress');
      } else if (error instanceof LeadSyncConfigError) {
        this.logger.warn(`Lead sync tick skipped: ${error.message}`);
      } else {
        this.logger.error(
          `Lead sync tick failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** ISO time of the next beat, or null when no schedule is running. */
  nextRunAt(): string | null {
    if (!this.registry.doesExist('cron', LEAD_SYNC_JOB)) return null;
    return this.registry.getCronJob(LEAD_SYNC_JOB).nextDate().toISO();
  }
}
