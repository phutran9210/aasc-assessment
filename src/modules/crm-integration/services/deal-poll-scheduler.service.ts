import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { DealPollService } from './deal-poll.service.js';

const INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000;
const FULL_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DealPollSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DealPollSchedulerService.name);
  private incrementalTimer?: ReturnType<typeof setInterval>;
  private fullTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly polls: DealPollService) {}

  onModuleInit(): void {
    if (!validateTiktokEnv(process.env).schedulerEnabled) return;
    this.incrementalTimer = setInterval(
      () => void this.run('incremental'),
      INCREMENTAL_INTERVAL_MS,
    );
    this.fullTimer = setInterval(() => void this.run('full'), FULL_INTERVAL_MS);
    this.incrementalTimer.unref();
    this.fullTimer.unref();
    void this.run('incremental').then(async () => {
      if (await this.polls.isFullScanDue()) await this.run('full');
    });
  }

  onApplicationShutdown(): void {
    if (this.incrementalTimer) clearInterval(this.incrementalTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
  }

  private async run(mode: 'incremental' | 'full'): Promise<void> {
    try {
      const summary = await this.polls.run(mode);
      if (summary.skippedLocked) {
        const retry = setTimeout(() => void this.run(mode), 60_000);
        retry.unref();
      }
      if (!summary.complete && !summary.skippedLocked)
        this.logger.warn(`Bitrix deal ${mode} poll stopped before completion`);
    } catch (error) {
      this.logger.warn(
        `Bitrix deal ${mode} poll failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    }
  }
}
