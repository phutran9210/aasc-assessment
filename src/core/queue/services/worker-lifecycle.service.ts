import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';

import type { QueueName } from '@core/queue/types/operation.types.js';
import type { RedisConnectionFactory } from '../redis-connection.js';
import { QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { OperationRunnerService } from './operation-runner.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { RecoverySweeperService } from './recovery-sweeper.service.js';

const CLOSE_DEADLINE_MS = 60_000;
const OUTBOX_POLL_MS = 1_000;
const RECOVERY_SWEEP_MS = 60_000;

@Injectable()
export class WorkerLifecycleService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLifecycleService.name);
  private readonly workers: Worker[] = [];
  private outboxTimer: ReturnType<typeof setInterval> | undefined;
  private recoveryTimer: ReturnType<typeof setInterval> | undefined;
  private outboxBusy = false;
  private recoveryBusy = false;

  constructor(
    private readonly redis: RedisConnectionFactory,
    private readonly runner: OperationRunnerService,
    private readonly prefix: string,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly recovery: RecoverySweeperService,
  ) {}

  onModuleInit(): void {
    for (const queue of Object.values(QUEUE_NAMES)) this.start(queue);
    this.outboxTimer = setInterval(() => void this.dispatchOutbox(), OUTBOX_POLL_MS);
    this.recoveryTimer = setInterval(() => void this.runRecovery(), RECOVERY_SWEEP_MS);
    this.outboxTimer.unref();
    this.recoveryTimer.unref();
    void this.dispatchOutbox();
    void this.runRecovery();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    const close = Promise.all(this.workers.map((worker) => worker.close()));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        close,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Worker shutdown exceeded 60 seconds')),
            CLOSE_DEADLINE_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async dispatchOutbox(): Promise<void> {
    if (this.outboxBusy) return;
    this.outboxBusy = true;
    try {
      await this.dispatcher.dispatchOnce(50);
    } catch (error) {
      this.logger.warn(
        `Outbox dispatch failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    } finally {
      this.outboxBusy = false;
    }
  }

  private async runRecovery(): Promise<void> {
    if (this.recoveryBusy) return;
    this.recoveryBusy = true;
    try {
      await this.recovery.sweep(100);
    } catch (error) {
      this.logger.warn(
        `Recovery sweep failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    } finally {
      this.recoveryBusy = false;
    }
  }

  private start(queue: QueueName): void {
    const worker = new Worker(
      queue,
      async (job: Job<{ operationId?: unknown }>) => {
        const operationId = job.data?.operationId;
        if (typeof operationId !== 'string' || operationId.length > 64) {
          throw new Error('Invalid operation job payload');
        }
        const outcome = await this.runner.run(operationId);
        if (outcome && outcome.outcome !== 'succeeded') {
          throw new Error(`Operation ended as ${outcome.outcome}`);
        }
      },
      {
        connection: this.redis.worker(),
        prefix: this.prefix,
        concurrency: 5,
      },
    );
    worker.on('error', (error: Error) =>
      this.logger.error(`Queue worker ${queue} failed: ${error.name}`),
    );
    this.workers.push(worker);
  }
}
