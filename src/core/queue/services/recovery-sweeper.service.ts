import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { OperationEntity } from '../entities/operation.entity.js';
import { OutboxEntity } from '../entities/outbox.entity.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { QUEUE_NAMES } from '../../../modules/crm-integration/types/integration.types.js';
import type {
  OperationKind,
  QueueName,
} from '../../../modules/crm-integration/types/integration.types.js';

const OPERATION_QUEUE: Record<OperationKind, QueueName> = {
  tiktok_ingest: QUEUE_NAMES.tiktokIngest,
  bitrix_lead_sync: QUEUE_NAMES.bitrixLeadSync,
  bitrix_deal_convert: QUEUE_NAMES.bitrixDealConvert,
  bitrix_deal_refresh: QUEUE_NAMES.bitrixDealRefresh,
  tiktok_feedback: QUEUE_NAMES.tiktokFeedback,
  integration_report: QUEUE_NAMES.integrationReport,
  integration_notification: QUEUE_NAMES.integrationNotification,
  integration_dlq: QUEUE_NAMES.integrationDlq,
  historical_lead_import: QUEUE_NAMES.tiktokIngest,
  campaign_cost_import: QUEUE_NAMES.integrationReport,
};

@Injectable()
export class RecoverySweeperService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxRepository,
    private readonly staleDispatchMs = 60_000,
  ) {}

  async sweep(
    limit = 100,
    now = new Date(),
  ): Promise<{ redispatched: number; reconciled: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OperationEntity);
      const candidates = await repository
        .createQueryBuilder('operation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where("operation.status IN ('pending', 'retry_wait')")
        .andWhere('(operation.nextAttemptAt IS NULL OR operation.nextAttemptAt <= :now)', { now })
        .orWhere("operation.status = 'processing' AND operation.leaseUntil <= :now", { now })
        .orderBy('operation.updatedAt', 'ASC')
        .take(limit)
        .getMany();
      let redispatched = 0;
      let reconciled = 0;
      for (const operation of candidates) {
        if (operation.status === 'processing') {
          operation.status = 'reconcile_required';
          operation.leaseToken = null;
          operation.leaseUntil = null;
          operation.lastErrorCode = 'WORKER_LEASE_EXPIRED';
          await repository.save(operation);
          reconciled += 1;
          continue;
        }
        if (await this.recoverDispatch(manager, operation, now)) redispatched += 1;
      }
      return { redispatched, reconciled };
    });
  }

  private async recoverDispatch(
    manager: EntityManager,
    operation: OperationEntity,
    now: Date,
  ): Promise<boolean> {
    const latest = await manager.getRepository(OutboxEntity).findOne({
      where: { operationId: operation.id },
      order: { dispatchGeneration: 'DESC' },
    });
    if (latest && !latest.publishedAt) return false;
    if (latest && latest.createdAt.getTime() > now.getTime() - this.staleDispatchMs) return false;
    if (operation.nextAttemptAt && operation.nextAttemptAt.getTime() > now.getTime()) return false;
    await this.outbox.append(operation.id, OPERATION_QUEUE[operation.kind], now, manager);
    return true;
  }
}
