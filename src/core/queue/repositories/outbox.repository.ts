import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OperationEntity } from '../entities/operation.entity.js';
import { OutboxEntity } from '../entities/outbox.entity.js';
import { QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { QueueName } from '@core/queue/types/operation.types.js';

const ALLOWED_QUEUES = new Set<string>(Object.values(QUEUE_NAMES));

@Injectable()
export class OutboxRepository {
  async append(
    operationId: string,
    queue: QueueName,
    availableAt: Date,
    tx: EntityManager,
  ): Promise<void> {
    if (!ALLOWED_QUEUES.has(queue)) throw new BadRequestException('Queue is not allowed');
    const operation = await tx
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .setLock('pessimistic_write')
      .where('operation.id = :operationId', { operationId })
      .getOne();
    if (!operation) throw new NotFoundException('Operation was not found');

    const previous = await tx.getRepository(OutboxEntity).findOne({
      where: { operationId },
      order: { dispatchGeneration: 'DESC' },
    });
    const dispatchGeneration = (previous?.dispatchGeneration ?? 0) + 1;
    const entry = tx.getRepository(OutboxEntity).create({
      id: uuidv7(),
      operationId,
      queue,
      dispatchGeneration,
      jobKey: `${operationId}-${dispatchGeneration}`,
      payload: { operationId },
      availableAt,
      publishedAt: null,
      leaseUntil: null,
      leaseOwner: null,
    });
    await tx.getRepository(OutboxEntity).save(entry);
  }
}
