import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { nowIso } from '@common/utils/temporal.util.js';

export type ScheduledTask = {
  name: string;
  intervalMs: number;
  run(now: string): Promise<unknown>;
};

/**
 * The one place the worker owns timers for recurring integration work. It only starts when the
 * scheduler flag is on; every task is safe to run on several workers because each takes its own
 * database lock or unique key, so the flag selects who ticks, not who is allowed to.
 */
@Injectable()
export class SchedulerRegistryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerRegistryService.name);
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly tasks: readonly ScheduledTask[],
    private readonly enabled: boolean,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    for (const task of this.tasks) {
      const timer = setInterval(() => void this.runTask(task), task.intervalMs);
      timer.unref();
      this.timers.push(timer);
      void this.runTask(task);
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  /** Runs a task unless its previous run is still in flight; a failure never stops the timer. */
  async runTask(task: ScheduledTask, now: string = nowIso()): Promise<void> {
    if (this.running.has(task.name)) return;
    this.running.add(task.name);
    try {
      await task.run(now);
    } catch (error) {
      this.logger.warn(
        `Scheduled task ${task.name} failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    } finally {
      this.running.delete(task.name);
    }
  }
}
