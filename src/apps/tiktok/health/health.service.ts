import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { MetricsRecorder } from '@common/logging/integration-logger.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type { RedisConnectionFactory } from '@core/queue/redis-connection.js';
import { WORKER_HEARTBEAT_STALE_MS } from '@core/queue/services/worker-heartbeat.service.js';
import type { WorkerHeartbeatService } from '@core/queue/services/worker-heartbeat.service.js';

export type CheckStatus = 'ok' | 'down' | 'stale' | 'not_required';

export type ReadinessMetrics = {
  oldestPendingSeconds: number;
  deadLetters: number;
  reconcileRequired: number;
  retryWaiting: number;
};

export type ReadinessDto = {
  status: 'ok' | 'unavailable';
  checkedAt: string;
  checks: {
    database: CheckStatus;
    schema: CheckStatus;
    redis: CheckStatus;
    config: CheckStatus;
    worker: CheckStatus;
  };
  /** Configured provider modes; readiness never calls TikTok or Bitrix24 to verify them. */
  providerMode: { tiktok: string; bitrix: string };
  metrics: ReadinessMetrics | null;
};

export type HealthConfig = {
  tiktokMode: string;
  bitrixMode: string;
  /** True when this deployment runs a worker that readiness should wait for. */
  workerRequired: boolean;
};

const DATABASE_TIMEOUT_MS = 2_000;
const REDIS_TIMEOUT_MS = 1_000;
const SCHEMA_CACHE_MS = 60_000;

@Injectable()
export class TiktokHealthService {
  private schemaCheckedAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisConnectionFactory,
    private readonly heartbeat: WorkerHeartbeatService,
    private readonly metrics: MetricsRecorder,
    private readonly config: HealthConfig,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Liveness is about this process only. */
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness covers what this service owns: its database and schema, Redis, its validated
   * configuration and, when one is deployed, the worker heartbeat. Every check is bounded by a
   * timeout and none of them reaches an upstream provider.
   */
  async ready(): Promise<ReadinessDto> {
    const now = this.clock();
    const metrics = await this.databaseMetrics(now);
    const redis = await this.redisStatus();
    const checks: ReadinessDto['checks'] = {
      database: metrics ? 'ok' : 'down',
      schema: await this.schemaStatus(now),
      redis,
      // The environment is validated when the application boots, before it can serve this route.
      config: 'ok',
      worker: await this.workerStatus(now, redis),
    };
    if (metrics) this.publish(metrics);
    return {
      status: Object.values(checks).every((check) => check === 'ok' || check === 'not_required')
        ? 'ok'
        : 'unavailable',
      checkedAt: new Date(now).toISOString(),
      checks,
      providerMode: { tiktok: this.config.tiktokMode, bitrix: this.config.bitrixMode },
      metrics,
    };
  }

  private async databaseMetrics(now: number): Promise<ReadinessMetrics | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL statement_timeout = ${DATABASE_TIMEOUT_MS}`);
        const row = await manager
          .getRepository(OperationEntity)
          .createQueryBuilder('operation')
          .select(
            `MIN(operation.created_at) FILTER (WHERE operation.status IN ('pending', 'processing'))`,
            'oldestPending',
          )
          .addSelect(`COUNT(*) FILTER (WHERE operation.status = 'dead_letter')`, 'deadLetters')
          .addSelect(
            `COUNT(*) FILTER (WHERE operation.status = 'reconcile_required')`,
            'reconcileRequired',
          )
          .addSelect(`COUNT(*) FILTER (WHERE operation.status = 'retry_wait')`, 'retryWaiting')
          .getRawOne<{
            oldestPending: Date | null;
            deadLetters: string;
            reconcileRequired: string;
            retryWaiting: string;
          }>();
        return {
          oldestPendingSeconds: row?.oldestPending
            ? Math.max(0, Math.floor((now - new Date(row.oldestPending).getTime()) / 1000))
            : 0,
          deadLetters: Number(row?.deadLetters ?? 0),
          reconcileRequired: Number(row?.reconcileRequired ?? 0),
          retryWaiting: Number(row?.retryWaiting ?? 0),
        };
      });
    } catch {
      return null;
    }
  }

  /** Pending migrations mean the schema does not match this build; a pass is cached briefly. */
  private async schemaStatus(now: number): Promise<CheckStatus> {
    if (this.schemaCheckedAt && now - this.schemaCheckedAt < SCHEMA_CACHE_MS) return 'ok';
    try {
      if (await withTimeout(this.dataSource.showMigrations(), DATABASE_TIMEOUT_MS)) return 'down';
      this.schemaCheckedAt = now;
      return 'ok';
    } catch {
      return 'down';
    }
  }

  private async redisStatus(): Promise<CheckStatus> {
    try {
      const client = await withTimeout(this.redis.shared(), REDIS_TIMEOUT_MS);
      await withTimeout(client.ping(), REDIS_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'down';
    }
  }

  private async workerStatus(now: number, redis: CheckStatus): Promise<CheckStatus> {
    if (!this.config.workerRequired) return 'not_required';
    if (redis !== 'ok') return 'down';
    try {
      const latest = await withTimeout(this.heartbeat.latestBeatAt(), REDIS_TIMEOUT_MS);
      if (latest === null) return 'down';
      return now - latest > WORKER_HEARTBEAT_STALE_MS ? 'stale' : 'ok';
    } catch {
      return 'down';
    }
  }

  private publish(metrics: ReadinessMetrics): void {
    this.metrics.record('integration_oldest_pending_seconds', metrics.oldestPendingSeconds, {
      check: 'queue',
    });
    this.metrics.record('integration_dead_letter_operations', metrics.deadLetters, {
      status: 'dead_letter',
    });
    this.metrics.record('integration_reconcile_required_operations', metrics.reconcileRequired, {
      status: 'reconcile_required',
    });
    this.metrics.record('integration_retry_waiting_operations', metrics.retryWaiting, {
      status: 'retry_wait',
    });
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Health check timed out')), timeoutMs);
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('Health check failed'));
      },
    );
  });
}
