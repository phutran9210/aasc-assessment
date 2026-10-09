import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationService } from './notification.service.js';

export type AlertType = 'dead_letter' | 'pending_backlog' | 'upstream_auth' | 'failure_rate';

export type AlertSummary = {
  /** Alerts announced by this evaluation. */
  fired: AlertType[];
  /** Alerts that returned to normal and were announced as recovered by this evaluation. */
  recovered: AlertType[];
  /** Every condition that currently holds, announced now or earlier. */
  active: AlertType[];
};

export const ALERT_DEDUP_WINDOW_MS = 30 * 60 * 1000;
export const PENDING_BACKLOG_MS = 5 * 60 * 1000;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const FAILURE_RATE_THRESHOLD = 0.05;
export const FAILURE_RATE_MIN_OPERATIONS = 20;

// Operations that move business data; notification and dead-letter bookkeeping is excluded.
const DATA_KINDS = [
  'tiktok_ingest',
  'bitrix_lead_sync',
  'bitrix_deal_convert',
  'bitrix_deal_refresh',
  'tiktok_feedback',
  'crm_timeline',
  'integration_report',
  'historical_lead_import',
  'campaign_cost_import',
];
const FAILED_STATUSES = ['dead_letter', 'quarantined', 'reconcile_required'];
const AUTH_ERROR_PATTERNS = ['%AUTH%', '%TOKEN%', '%UNAUTHORIZED%', '%FORBIDDEN%'];

type Condition = { type: AlertType; active: boolean; detail: Record<string, unknown> };

/**
 * Evaluates the operational alerts from the operation ledger in PostgreSQL, so an alert is not
 * lost while Redis is down. Each alert is announced once per 30 minute window and followed by a
 * single recovery notice when its condition clears.
 */
@Injectable()
export class AlertService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
    private readonly notificationRows: NotificationRepository,
    private readonly scope: { advertiserId: string },
  ) {}

  async evaluate(now: string): Promise<AlertSummary> {
    const at = new Date(now);
    const conditions = await this.conditions(at);
    const summary: AlertSummary = { fired: [], recovered: [], active: [] };
    const window = Math.floor(at.getTime() / ALERT_DEDUP_WINDOW_MS);

    for (const condition of conditions) {
      const firing = `alert.${condition.type}`;
      const recovery = `${firing}.recovered`;
      await this.dataSource.transaction(async (tx) => {
        // One evaluator at a time per alert type, across every worker.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `integration-alert/${condition.type}`,
        ]);
        if (condition.active) {
          summary.active.push(condition.type);
          const { created } = await this.notifications.ensureOnce(
            {
              dedupKey: `alert/${condition.type}/${this.scope.advertiserId}/${window}`,
              type: firing,
              payload: { ...condition.detail, scope: this.scope.advertiserId, evaluatedAt: now },
            },
            tx,
          );
          if (created) summary.fired.push(condition.type);
          return;
        }
        const latest = await this.notificationRows.latestOfTypes([firing, recovery], tx);
        if (latest?.type !== firing) return;
        const { created } = await this.notifications.ensureOnce(
          {
            dedupKey: `alert-recovered/${latest.id}`,
            type: recovery,
            payload: { scope: this.scope.advertiserId, recoveredAt: now, alertId: latest.id },
          },
          tx,
        );
        if (created) summary.recovered.push(condition.type);
      });
    }
    return summary;
  }

  private async conditions(now: Date): Promise<Condition[]> {
    const manager = this.dataSource.manager;
    const since = new Date(now.getTime() - FAILURE_WINDOW_MS);

    const deadLetters = await this.operations(manager)
      .andWhere(`operation.status = 'dead_letter'`)
      .getCount();

    const backlog = await this.operations(manager)
      .select('MIN(operation.created_at)', 'oldest')
      .andWhere(`operation.status IN ('pending', 'processing')`)
      .andWhere('operation.created_at < :threshold', {
        threshold: new Date(now.getTime() - PENDING_BACKLOG_MS),
      })
      .getRawOne<{ oldest: Date | null }>();

    const authFailures = await this.recent(manager, since, now)
      .andWhere('operation.last_error_code ILIKE ANY(:patterns)', { patterns: AUTH_ERROR_PATTERNS })
      .getCount();

    const outcomes = await this.recent(manager, since, now)
      .select(`COUNT(*) FILTER (WHERE operation.status = 'succeeded')`, 'succeeded')
      .addSelect(`COUNT(*) FILTER (WHERE operation.status IN (:...failed))`, 'failed')
      .setParameter('failed', FAILED_STATUSES)
      .getRawOne<{ succeeded: string; failed: string }>();
    const failed = Number(outcomes?.failed ?? 0);
    const finished = failed + Number(outcomes?.succeeded ?? 0);

    return [
      { type: 'dead_letter', active: deadLetters > 0, detail: { deadLetters } },
      {
        type: 'pending_backlog',
        active: Boolean(backlog?.oldest),
        detail: {
          oldestPendingAt: backlog?.oldest ? new Date(backlog.oldest).toISOString() : null,
        },
      },
      { type: 'upstream_auth', active: authFailures > 0, detail: { authFailures } },
      {
        type: 'failure_rate',
        active:
          finished >= FAILURE_RATE_MIN_OPERATIONS && failed / finished > FAILURE_RATE_THRESHOLD,
        detail: { failed, finished, windowMinutes: FAILURE_WINDOW_MS / 60_000 },
      },
    ];
  }

  private operations(manager: EntityManager): SelectQueryBuilder<OperationEntity> {
    return manager
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .where('operation.kind IN (:...kinds)', { kinds: DATA_KINDS });
  }

  private recent(manager: EntityManager, since: Date, now: Date) {
    return this.operations(manager).andWhere(
      'operation.updated_at > :since AND operation.updated_at <= :now',
      { since, now },
    );
  }
}
