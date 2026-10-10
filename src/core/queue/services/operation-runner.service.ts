import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { DataSource, EntityManager } from 'typeorm';

import { OperationEntity } from '../entities/operation.entity.js';
import { AggregateLeaseRepository } from '../repositories/aggregate-lease.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import type { AggregateLease } from '../types/operation.types.js';
import { OPERATION_QUEUE, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { OperationKind } from '@core/queue/types/operation.types.js';
import type {
  OperationContext,
  OperationHandlerRegistry,
  OperationOutcome,
} from '../types/worker.types.js';
import { OperationFailure, RetryPolicy } from './retry-policy.service.js';

const OPERATION_LEASE_MS = 60_000;
const HEARTBEAT_MS = 10_000;

type ClaimedOperation = OperationEntity & { leaseToken: string };
class OwnershipLostError extends Error {}

@Injectable()
export class OperationRunnerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly handlers: OperationHandlerRegistry,
    private readonly aggregateLeases: AggregateLeaseRepository,
    private readonly outbox: OutboxRepository,
    private readonly retryPolicy = new RetryPolicy(),
  ) {}

  async run(operationId: string): Promise<OperationOutcome | null> {
    const operation = await this.claim(operationId);
    if (!operation) return null;
    const controller = new AbortController();
    const aggregateLeases = new Map<string, AggregateLease>();
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void this.renewOwnership(operation, aggregateLeases, controller)
        .catch(() => controller.abort(new Error('Lease heartbeat failed')))
        .finally(() => {
          heartbeatBusy = false;
        });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const handler = this.handlers.get(operation.kind);
      if (!handler) {
        return this.finish(operation, {
          outcome: 'quarantined',
          errorCode: 'HANDLER_NOT_ENABLED',
        });
      }
      const context: OperationContext = {
        operationId: operation.id,
        ownerToken: operation.leaseToken,
        attempt: operation.attempt,
        revisions: operation.configRevisions,
        signal: controller.signal,
        assertOwnership: () => this.assertOwnership(operation, aggregateLeases, controller.signal),
        acquireAggregateLease: async (key) => {
          await this.assertOwnership(operation, aggregateLeases, controller.signal);
          const lease = await this.aggregateLeases.claim(key, OPERATION_LEASE_MS);
          if (lease) aggregateLeases.set(key, lease);
          return lease;
        },
        releaseAggregateLease: async (lease) => {
          const released = await this.aggregateLeases.release(lease);
          if (released) aggregateLeases.delete(lease.key);
          return released;
        },
      };
      await context.assertOwnership();
      const outcome = await handler.handle(context);
      await context.assertOwnership();
      return await this.finish(
        operation,
        this.retryPolicy.enforce(outcome, operation.attempt, new Date()),
      );
    } catch (error) {
      if (controller.signal.aborted || error instanceof OwnershipLostError) return null;
      const failure =
        error instanceof OperationFailure
          ? error
          : new OperationFailure('transient', 'UNEXPECTED_OPERATION_ERROR');
      const outcome = this.retryPolicy.decide(failure, operation.attempt, new Date());
      return await this.finish(operation, outcome);
    } finally {
      clearInterval(heartbeat);
      await Promise.all(
        [...aggregateLeases.values()].map((lease) => this.aggregateLeases.release(lease)),
      );
    }
  }

  private async claim(operationId: string): Promise<ClaimedOperation | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OperationEntity);
      const operation = await repository.findOne({
        where: { id: operationId },
        select: {
          id: true,
          operationKey: true,
          kind: true,
          aggregateId: true,
          targetVersion: true,
          status: true,
          attempt: true,
          leaseUntil: true,
          leaseToken: true,
          remoteId: true,
          lastErrorCode: true,
          lastErrorDetail: true,
          nextAttemptAt: true,
          payload: true,
          configRevisions: true,
          actorId: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!operation || !['pending', 'retry_wait'].includes(operation.status)) return null;
      if (operation.nextAttemptAt && operation.nextAttemptAt.getTime() > Date.now()) return null;
      const leaseToken = randomUUID();
      operation.status = 'processing';
      operation.attempt += 1;
      operation.leaseToken = leaseToken;
      operation.leaseUntil = new Date(Date.now() + OPERATION_LEASE_MS);
      operation.nextAttemptAt = null;
      await repository.save(operation);
      return operation as ClaimedOperation;
    });
  }

  private async assertOwnership(
    operation: ClaimedOperation,
    aggregateLeases: Map<string, AggregateLease>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new OwnershipLostError('Operation ownership was lost');
    const owns = await this.dataSource
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .where('operation.id = :id', { id: operation.id })
      .andWhere('operation.leaseToken = :leaseToken', { leaseToken: operation.leaseToken })
      .andWhere("operation.status = 'processing'")
      .andWhere('operation.leaseUntil > NOW()')
      .getExists();
    if (!owns) {
      throw new OwnershipLostError('Operation ownership was lost');
    }
    for (const lease of aggregateLeases.values()) {
      if (!(await this.aggregateLeases.isOwner(lease))) {
        throw new OwnershipLostError('Aggregate lease was lost');
      }
    }
  }

  private async renewOwnership(
    operation: ClaimedOperation,
    aggregateLeases: Map<string, AggregateLease>,
    controller: AbortController,
  ): Promise<void> {
    const renewed = await this.dataSource
      .getRepository(OperationEntity)
      .createQueryBuilder()
      .update(OperationEntity)
      .set({ leaseUntil: new Date(Date.now() + OPERATION_LEASE_MS) })
      .where('id = :id AND lease_token = :leaseToken', {
        id: operation.id,
        leaseToken: operation.leaseToken,
      })
      .andWhere("status = 'processing'")
      .execute();
    if (renewed.affected !== 1) {
      controller.abort(new Error('Operation lease was lost'));
      return;
    }
    for (const [key, lease] of aggregateLeases) {
      const next = await this.aggregateLeases.renew(lease, OPERATION_LEASE_MS);
      if (!next) {
        aggregateLeases.delete(key);
        controller.abort(new Error('Aggregate lease was lost'));
        return;
      }
      aggregateLeases.set(key, next);
    }
  }

  private async finish(
    claimed: ClaimedOperation,
    outcome: OperationOutcome,
  ): Promise<OperationOutcome | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OperationEntity);
      const operation = await repository.findOne({
        where: { id: claimed.id, leaseToken: claimed.leaseToken, status: 'processing' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!operation) return null;
      operation.status = outcome.outcome;
      operation.leaseToken = null;
      operation.leaseUntil = null;
      operation.lastErrorCode = 'errorCode' in outcome ? outcome.errorCode : null;
      operation.lastErrorDetail = null;
      if (outcome.outcome === 'succeeded') {
        operation.remoteId = outcome.remoteId ?? operation.remoteId;
        operation.completedAt = new Date();
        operation.lastErrorCode = null;
      } else if (outcome.outcome === 'retry_wait') {
        operation.nextAttemptAt = outcome.nextAttemptAt;
        if (outcome.deferred) operation.attempt -= 1;
        await this.outbox.append(
          operation.id,
          OPERATION_QUEUE[operation.kind],
          outcome.nextAttemptAt,
          manager,
        );
      }
      await repository.save(operation);
      if (outcome.outcome === 'dead_letter') await this.writeDeadLetter(manager, operation);
      return outcome;
    });
  }

  private async writeDeadLetter(manager: EntityManager, failed: OperationEntity): Promise<void> {
    const now = new Date();
    const dlq = await this.ensureSystemOperation(manager, {
      key: `dlq/${failed.id}`,
      kind: 'integration_dlq',
      payload: {
        sourceOperationId: failed.id,
        targetVersion: failed.attempt,
        errorCode: failed.lastErrorCode ?? undefined,
      },
    });
    await this.outbox.append(dlq.id, QUEUE_NAMES.integrationDlq, now, manager);
    const notification = await this.ensureSystemOperation(manager, {
      key: `dlq-notification/${failed.id}`,
      kind: 'integration_notification',
      payload: {
        sourceOperationId: failed.id,
        targetVersion: failed.attempt,
        errorCode: failed.lastErrorCode ?? undefined,
      },
    });
    await this.outbox.append(notification.id, QUEUE_NAMES.integrationNotification, now, manager);
  }

  private async ensureSystemOperation(
    manager: EntityManager,
    input: { key: string; kind: OperationKind; payload: OperationEntity['payload'] },
  ): Promise<OperationEntity> {
    const repository = manager.getRepository(OperationEntity);
    await repository
      .createQueryBuilder()
      .insert()
      .values({
        id: uuidv7(),
        operationKey: input.key,
        kind: input.kind,
        aggregateId: null,
        targetVersion: null,
        status: 'pending',
        attempt: 0,
        leaseUntil: null,
        leaseToken: null,
        remoteId: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        nextAttemptAt: null,
        payload: input.payload,
        configRevisions: {},
        actorId: null,
        completedAt: null,
      })
      .orIgnore()
      .execute();
    const operation = await repository.findOneBy({ operationKey: input.key });
    if (!operation) throw new Error('Could not persist system operation');
    return operation;
  }
}
