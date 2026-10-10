import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { OperationEntity } from '../entities/operation.entity.js';
import { OutboxEntity } from '../entities/outbox.entity.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import {
  OPERATION_QUEUE,
  REPLAY_SAFE_OPERATION_KINDS,
} from '@core/queue/constants/operation.constants.js';

const REPLAY_SAFE_KINDS = new Set<string>(REPLAY_SAFE_OPERATION_KINDS);

@Injectable()
export class RecoverySweeperService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxRepository,
    private readonly staleDispatchMs = 60_000,
    private readonly maxReplayAttempts = 5,
  ) {}

  async sweep(
    limit = 100,
    now = new Date(),
  ): Promise<{ redispatched: number; reconciled: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OperationEntity);
      // Expired leases are read on their own so a backlog of waiting operations cannot crowd them
      // out of the batch.
      const expired = await repository
        .createQueryBuilder('operation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where("operation.status = 'processing' AND operation.leaseUntil <= :now", { now })
        .orderBy('operation.leaseUntil', 'ASC')
        .take(limit)
        .getMany();
      let redispatched = 0;
      let reconciled = 0;
      for (const operation of expired) {
        // A worker that died mid-mutation may or may not have reached the remote system, so that
        // case stays with an operator. Anything else is run again, until it has killed its worker
        // too many times to be a coincidence.
        const replay =
          REPLAY_SAFE_KINDS.has(operation.kind) && operation.attempt <= this.maxReplayAttempts;
        operation.status = replay ? 'pending' : 'reconcile_required';
        operation.leaseToken = null;
        operation.leaseUntil = null;
        operation.nextAttemptAt = null;
        operation.lastErrorCode = 'WORKER_LEASE_EXPIRED';
        await repository.save(operation);
        if (replay) {
          await this.outbox.append(operation.id, OPERATION_QUEUE[operation.kind], now, manager);
          redispatched += 1;
        } else {
          reconciled += 1;
        }
      }

      const waiting = await repository
        .createQueryBuilder('operation')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where("operation.status IN ('pending', 'retry_wait')")
        .andWhere('(operation.nextAttemptAt IS NULL OR operation.nextAttemptAt <= :now)', { now })
        .andWhere('operation.id NOT IN (:...recovered)', {
          recovered: ['00000000-0000-0000-0000-000000000000', ...expired.map((item) => item.id)],
        })
        .orderBy('operation.updatedAt', 'ASC')
        .take(limit)
        .getMany();
      for (const operation of waiting) {
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
