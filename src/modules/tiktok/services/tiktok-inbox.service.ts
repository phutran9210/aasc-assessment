import { createHash } from 'node:crypto';

import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import type { TiktokAppConfig } from '../../../config/tiktok-app/env.validation.js';
import { ConfigurationHeadEntity } from '../../crm-integration/entities/configuration-head.entity.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '../../crm-integration/types/integration.types.js';
import { WebhookEventEntity } from '../../../core/queue/entities/webhook-event.entity.js';
import { OutboxRepository } from '../../../core/queue/repositories/outbox.repository.js';
import { OperationRepository } from '../../../core/queue/repositories/operation.repository.js';
import { WebhookEventRepository } from '../../../core/queue/repositories/webhook-event.repository.js';
import type { VerifiedEvent } from '../domain/webhook-envelope.js';
import { TIKTOK_WEBHOOK_CONFIG } from '../guards/tiktok-signature.guard.js';

export type InboxReceipt = { received: true; eventId: string; duplicate: boolean };

const DISPATCHED_EVENTS = new Set(['lead.generate', 'form.complete', 'user.interaction']);

@Injectable()
export class TiktokInboxService {
  constructor(
    @Inject(getDataSourceToken('tiktok')) private readonly dataSource: DataSource,
    private readonly events: WebhookEventRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    @Inject(TIKTOK_WEBHOOK_CONFIG) private readonly config: TiktokAppConfig,
  ) {}

  async receive(event: VerifiedEvent, raw: Buffer): Promise<InboxReceipt> {
    if (event.advertiserId !== this.config.advertiserId) {
      throw new ConflictException('TikTok advertiser does not match configured scope');
    }
    const payloadHash = createHash('sha256').update(raw).digest('hex');
    try {
      return await this.dataSource.transaction(async (tx) => {
        const receipt = await this.events.accept(
          {
            provider: 'tiktok',
            providerMode: this.config.tiktokMode,
            scopeKey: event.advertiserId,
            advertiserId: event.advertiserId,
            eventKey: event.eventId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            rawBody: raw,
            payload: event.payload,
            payloadHash,
          },
          tx,
        );
        if (receipt.duplicate) return { received: true, ...receipt };

        if (!DISPATCHED_EVENTS.has(event.eventType)) {
          await tx.getRepository(WebhookEventEntity).update(receipt.eventId, { status: 'ignored' });
          return { received: true, ...receipt };
        }

        const heads = await tx.getRepository(ConfigurationHeadEntity).find();
        const revisions = Object.fromEntries(heads.map((head) => [head.key, head.revision]));
        const operation = await this.operations.ensure(
          {
            operationKey: `tiktok-ingest/${receipt.eventId}`,
            kind: OPERATION_KINDS.tiktokIngest,
            payload: { eventId: receipt.eventId },
            configRevisions: {
              mapping: revisions.mapping ?? 0,
              rules: revisions.rules ?? 0,
              scoring: revisions.scoring ?? 0,
            },
          },
          tx,
        );
        await this.outbox.append(operation.id, QUEUE_NAMES.tiktokIngest, new Date(), tx);
        return { received: true, ...receipt };
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Webhook could not be durably accepted');
    }
  }
}
