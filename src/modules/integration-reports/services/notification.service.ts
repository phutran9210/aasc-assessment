import { Injectable, Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type {
  ConversionFeedbackScheduler,
  FeedbackMilestone,
} from '@modules/crm-integration/ports/conversion-feedback.port.js';
import type { Actor, IntegrationRole } from '@modules/integration-auth/types/index.js';
import type { NotificationEntity } from '../entities/notification.entity.js';
import { NotificationRepository } from '../repositories/notification.repository.js';

export type NotificationChannel = 'in_app' | 'operational_log' | 'bitrix';

export type NotificationInput = {
  /** Identity of the fact being announced; a second `ensure` with the same key is a no-op. */
  dedupKey: string;
  type: string;
  recipientId?: string | null;
  /** Roles that see the notification when it has no single recipient. */
  audience?: IntegrationRole[];
  channels?: NotificationChannel[];
  /** Identifiers and codes only; never contact data or raw payloads. */
  payload: Record<string, unknown>;
};

export type NotificationDto = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
  sentAt: string | null;
};

/** Optional Bitrix24 channel; enabled only when the portal grants the notification scope. */
export type BitrixNotifier = {
  isEnabled(): Promise<boolean>;
  notify(message: { type: string; payload: Record<string, unknown> }): Promise<void>;
};

export const BITRIX_NOTIFIER = Symbol('BITRIX_NOTIFIER');

export const OPERATOR_AUDIENCE: IntegrationRole[] = ['integration_operator', 'integration_admin'];
const DEFAULT_CHANNELS: NotificationChannel[] = ['in_app', 'operational_log'];

/**
 * In-app notifications are rows written in the caller's transaction, so they exist exactly when
 * the fact they announce is committed. The structured log line and the optional Bitrix message
 * are delivered afterwards by a worker operation and can fail without undoing any CRM work.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly bitrix?: BitrixNotifier,
  ) {}

  async ensure(input: NotificationInput, tx: EntityManager): Promise<string> {
    return (await this.ensureOnce(input, tx)).id;
  }

  /** Like `ensure`, and tells whether this call created the notification. */
  async ensureOnce(
    input: NotificationInput,
    tx: EntityManager,
  ): Promise<{ id: string; created: boolean }> {
    const result = await this.insert(input, tx);
    if (!result.created) return result;
    const operation = await this.operations.ensure(
      {
        operationKey: `notification/${result.id}`,
        kind: OPERATION_KINDS.integrationNotification,
        payload: { notificationId: result.id },
      },
      tx,
    );
    await this.outbox.append(operation.id, QUEUE_NAMES.integrationNotification, new Date(), tx);
    return result;
  }

  /** Stores and delivers within the calling worker operation, without queueing a second one. */
  async deliverSystem(input: NotificationInput): Promise<void> {
    const { id } = await this.dataSource.transaction((tx) => this.insert(input, tx));
    await this.deliver(id);
  }

  /** Emits the outstanding channels of a stored notification; safe to repeat. */
  async deliver(notificationId: string): Promise<boolean> {
    const notification = await this.notifications.findById(notificationId);
    if (!notification) return false;
    if (notification.status === 'sent') return true;

    const channels = channelsOf(notification);
    if (channels.includes('bitrix') && this.bitrix && (await this.bitrix.isEnabled())) {
      await this.bitrix.notify({ type: notification.type, payload: notification.payload });
    }
    if (channels.includes('operational_log')) {
      this.logger.log(
        JSON.stringify({
          event: 'integration.notification',
          notificationId: notification.id,
          type: notification.type,
          dedupKey: notification.dedupKey,
          payload: notification.payload,
        }),
      );
    }
    await this.notifications.markSent(notification.id, new Date());
    return true;
  }

  async list(
    actor: Actor,
    page: number,
    limit: number,
  ): Promise<{ items: NotificationDto[]; total: number; page: number; limit: number }> {
    const [rows, total] = await this.notifications.listFor(actor.sub, actor.roles, page, limit);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  private insert(input: NotificationInput, tx: EntityManager) {
    return this.notifications.insertOnce(
      {
        dedupKey: input.dedupKey,
        type: input.type,
        recipientId: input.recipientId ?? null,
        channel: 'in_app',
        status: 'pending',
        payload: {
          ...input.payload,
          audience: input.recipientId ? [] : (input.audience ?? OPERATOR_AUDIENCE),
          channels: input.channels ?? DEFAULT_CHANNELS,
        },
      },
      tx,
    );
  }
}

/**
 * Sits on the conversion milestone port: the TikTok feedback scheduler keeps its behaviour and
 * operators additionally get one in-app notification when a deal is created or won.
 */
export class ConversionNotificationListener implements ConversionFeedbackScheduler {
  constructor(
    private readonly notifications: Pick<NotificationService, 'ensure'>,
    private readonly feedback?: ConversionFeedbackScheduler,
  ) {}

  async schedule(leadId: string, milestone: FeedbackMilestone, tx: EntityManager): Promise<void> {
    await this.feedback?.schedule(leadId, milestone, tx);
    if (milestone === 'lead_qualified') return;
    await this.notifications.ensure(
      {
        dedupKey: `conversion/${leadId}/${milestone}`,
        type: `conversion.${milestone}`,
        payload: { leadId, milestone },
      },
      tx,
    );
  }
}

function channelsOf(notification: NotificationEntity): NotificationChannel[] {
  const channels = notification.payload.channels;
  return Array.isArray(channels) ? (channels as NotificationChannel[]) : DEFAULT_CHANNELS;
}
