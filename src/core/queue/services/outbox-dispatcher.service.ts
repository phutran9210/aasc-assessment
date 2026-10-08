import { randomUUID } from 'node:crypto';

import type { Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { DataSource, EntityManager } from 'typeorm';

import { OutboxEntity } from '../entities/outbox.entity.js';
import type { QueueName } from '../../../modules/crm-integration/types/integration.types.js';

type QueueRegistry = ReadonlyMap<QueueName, Queue>;
type LeasedOutboxRow = OutboxEntity & { leaseOwner: string };

const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class OutboxDispatcherService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly queues: QueueRegistry,
    private readonly leaseMs = 30_000,
  ) {}

  async dispatchOnce(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    const rows = await this.claim(limit);
    let published = 0;
    for (const row of rows) {
      const queue = this.queues.get(row.queue as QueueName);
      if (!queue) throw new Error(`No queue is registered for ${row.queue}`);
      await queue.add(
        'dispatch-operation',
        { operationId: row.operationId },
        {
          jobId: row.jobKey,
          attempts: 1,
          removeOnComplete: { age: FAILED_JOB_RETENTION_SECONDS },
          removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
        },
      );
      if (await this.markPublished(row.id, row.leaseOwner)) published += 1;
    }
    return published;
  }

  protected async markPublished(id: string, ownerToken: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(OutboxEntity)
      .update(
        { id, leaseOwner: ownerToken, publishedAt: IsNull() },
        { publishedAt: new Date(), leaseOwner: null, leaseUntil: null },
      );
    return result.affected === 1;
  }

  private async claim(limit: number): Promise<LeasedOutboxRow[]> {
    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const rows = await this.selectAvailable(manager, limit, now);
      const leased: LeasedOutboxRow[] = [];
      for (const row of rows) {
        const ownerToken = randomUUID();
        row.leaseOwner = ownerToken;
        row.leaseUntil = new Date(now.getTime() + this.leaseMs);
        await manager
          .getRepository(OutboxEntity)
          .update({ id: row.id }, { leaseOwner: ownerToken, leaseUntil: row.leaseUntil });
        leased.push(row as LeasedOutboxRow);
      }
      return leased;
    });
  }

  private selectAvailable(
    manager: EntityManager,
    limit: number,
    now: Date,
  ): Promise<OutboxEntity[]> {
    return manager
      .createQueryBuilder(OutboxEntity, 'outbox')
      .addSelect('outbox.leaseOwner')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('outbox.publishedAt IS NULL')
      .andWhere('outbox.availableAt <= :now', { now })
      .andWhere('(outbox.leaseUntil IS NULL OR outbox.leaseUntil <= :now)', { now })
      .orderBy('outbox.availableAt', 'ASC')
      .addOrderBy('outbox.createdAt', 'ASC')
      .take(limit)
      .getMany();
  }
}
