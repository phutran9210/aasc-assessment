import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '@core/queue/types/worker.types.js';
import { NotificationService } from '../services/notification.service.js';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 60_000;

/**
 * Consumes `integration_notification` operations (queued notifications and the dead-letter notices
 * written by the operation runner) and acknowledges `integration_dlq` records, whose ledger row is
 * the dead-letter entry itself.
 */
@Injectable()
export class NotificationHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    if (!operation) return { outcome: 'quarantined', errorCode: 'NOTIFICATION_PAYLOAD_INVALID' };
    if (operation.kind === 'integration_dlq') return { outcome: 'succeeded' };

    try {
      const { notificationId, sourceOperationId, errorCode } = operation.payload;
      if (notificationId) {
        return (await this.notifications.deliver(notificationId))
          ? { outcome: 'succeeded' }
          : { outcome: 'quarantined', errorCode: 'NOTIFICATION_NOT_FOUND' };
      }
      if (sourceOperationId) {
        await this.notifications.deliverSystem({
          dedupKey: `dead-letter/${sourceOperationId}`,
          type: 'operation.dead_letter',
          payload: { operationId: sourceOperationId, errorCode: errorCode ?? null },
        });
        return { outcome: 'succeeded' };
      }
      return { outcome: 'quarantined', errorCode: 'NOTIFICATION_PAYLOAD_INVALID' };
    } catch {
      const errorCode = 'NOTIFICATION_DELIVERY_FAILED';
      if (context.attempt >= MAX_ATTEMPTS) return { outcome: 'dead_letter', errorCode };
      return {
        outcome: 'retry_wait',
        errorCode,
        nextAttemptAt: new Date(
          Date.now() + Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (context.attempt - 1)),
        ),
      };
    }
  }
}
