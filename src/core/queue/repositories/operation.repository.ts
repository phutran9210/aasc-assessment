import { isDeepStrictEqual } from 'node:util';

import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { OperationEntity } from '../entities/operation.entity.js';
import type { EnsureOperationInput } from '../types/operation.types.js';

@Injectable()
export class OperationRepository {
  findById(id: string, tx: EntityManager): Promise<OperationEntity | null> {
    return tx.getRepository(OperationEntity).findOne({ where: { id } });
  }

  findByKey(operationKey: string, tx: EntityManager): Promise<OperationEntity | null> {
    return tx.getRepository(OperationEntity).findOne({ where: { operationKey } });
  }

  findByIdForUpdate(id: string, tx: EntityManager): Promise<OperationEntity | null> {
    return tx
      .getRepository(OperationEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  findByKeyForUpdate(operationKey: string, tx: EntityManager): Promise<OperationEntity | null> {
    return tx
      .getRepository(OperationEntity)
      .findOne({ where: { operationKey }, lock: { mode: 'pessimistic_write' } });
  }

  save(operation: OperationEntity, tx: EntityManager): Promise<OperationEntity> {
    return tx.getRepository(OperationEntity).save(operation);
  }

  create(input: Partial<OperationEntity>, tx: EntityManager): OperationEntity {
    return tx.getRepository(OperationEntity).create(input);
  }

  async hasActiveAggregateOperation(
    aggregateId: string,
    excludedOperationId: string,
    statuses: string[],
    tx: EntityManager,
  ): Promise<boolean> {
    const active = await tx
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .setLock('pessimistic_write')
      .where('operation.aggregateId = :aggregateId', { aggregateId })
      .andWhere('operation.id <> :excludedOperationId', { excludedOperationId })
      .andWhere('operation.status IN (:...statuses)', { statuses })
      .getOne();
    return active !== null;
  }

  async ensure(input: EnsureOperationInput, tx: EntityManager): Promise<OperationEntity> {
    const normalized = {
      operationKey: input.operationKey,
      kind: input.kind,
      aggregateId: input.aggregateId ?? null,
      targetVersion: input.targetVersion ?? null,
      payload: input.payload ?? {},
      configRevisions: input.configRevisions ?? {},
      actorId: input.actorId ?? null,
    };
    const insert = await tx
      .createQueryBuilder()
      .insert()
      .into(OperationEntity)
      .values({
        id: uuidv7(),
        ...normalized,
        status: 'pending',
        attempt: 0,
        leaseUntil: null,
        leaseToken: null,
        remoteId: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        nextAttemptAt: null,
        completedAt: null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const raw: unknown = insert.raw;
    const created = Array.isArray(raw) ? (raw[0] as { id?: string } | undefined) : undefined;
    const operation = created?.id
      ? await tx.getRepository(OperationEntity).findOne({ where: { id: created.id } })
      : await tx.getRepository(OperationEntity).findOne({
          where: { operationKey: input.operationKey },
        });
    if (!operation) throw new Error('Operation insert did not return a stored operation');
    if (
      operation.kind !== normalized.kind ||
      operation.aggregateId !== normalized.aggregateId ||
      operation.targetVersion !== normalized.targetVersion ||
      !isDeepStrictEqual(operation.payload, normalized.payload) ||
      !isDeepStrictEqual(operation.configRevisions, normalized.configRevisions) ||
      operation.actorId !== normalized.actorId
    ) {
      throw new ConflictException('Operation key was reused with different input');
    }
    return operation;
  }
}
