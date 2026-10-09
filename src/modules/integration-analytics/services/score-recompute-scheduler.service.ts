import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { nowIso } from '@common/utils/temporal.util.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { ScoreRecomputeService } from './score-recompute.service.js';

export const SCORE_RECOMPUTE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Runs the sliding-window score recompute once at worker start and then every day. */
@Injectable()
export class ScoreRecomputeSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScoreRecomputeSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly recompute: ScoreRecomputeService) {}

  onModuleInit(): void {
    if (!validateTiktokEnv(process.env).schedulerEnabled) return;
    this.timer = setInterval(() => void this.run(), SCORE_RECOMPUTE_INTERVAL_MS);
    this.timer.unref();
    void this.run();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const changed = await this.recompute.run(nowIso());
      if (changed) this.logger.log(`Recomputed the quality score of ${changed} lead(s)`);
    } catch (error) {
      this.logger.warn(
        `Score recompute failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    }
  }
}
