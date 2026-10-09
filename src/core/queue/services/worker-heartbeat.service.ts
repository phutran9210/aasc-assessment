import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import type { RedisConnectionFactory } from '../redis-connection.js';

export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const WORKER_HEARTBEAT_STALE_MS = 30_000;
const FORGET_AFTER_MS = 60 * 60 * 1000;

/**
 * Lets the API tell whether a worker is alive. Each worker writes its latest beat into one Redis
 * hash; readiness compares the freshest beat with its own clock and calls it stale after 30
 * seconds. A worker that stops simply stops writing, so no shutdown hook has to succeed.
 */
export class WorkerHeartbeatService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly redis: RedisConnectionFactory,
    private readonly workerId: string = randomUUID(),
    private readonly clock: () => number = Date.now,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeBeat(), WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
    void this.safeBeat();
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.timer) return;
    clearInterval(this.timer);
    try {
      await (await this.redis.shared()).hdel(this.key, this.workerId);
    } catch {
      // The entry ages out on its own.
    }
  }

  async beat(): Promise<void> {
    await (await this.redis.shared()).hset(this.key, this.workerId, String(this.clock()));
  }

  /** Epoch milliseconds of the freshest beat of any worker, or null when none was ever seen. */
  async latestBeatAt(): Promise<number | null> {
    const client = await this.redis.shared();
    const beats = await client.hgetall(this.key);
    const now = this.clock();
    let latest: number | null = null;
    for (const [workerId, value] of Object.entries(beats)) {
      const beatAt = Number(value);
      if (!Number.isFinite(beatAt) || now - beatAt > FORGET_AFTER_MS) {
        await client.hdel(this.key, workerId);
        continue;
      }
      if (latest === null || beatAt > latest) latest = beatAt;
    }
    return latest;
  }

  private get key(): string {
    return `${this.redis.prefix}:worker-heartbeats`;
  }

  private async safeBeat(): Promise<void> {
    try {
      await this.beat();
    } catch (error) {
      this.logger.warn(
        `Worker heartbeat failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
    }
  }
}
