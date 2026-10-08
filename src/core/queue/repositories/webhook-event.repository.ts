import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { WebhookEventEntity } from '../entities/webhook-event.entity.js';
import type { WebhookEventInput } from '../types/operation.types.js';

@Injectable()
export class WebhookEventRepository {
  async accept(
    input: WebhookEventInput,
    tx: EntityManager,
  ): Promise<{ eventId: string; duplicate: boolean }> {
    const insert = await tx
      .createQueryBuilder()
      .insert()
      .into(WebhookEventEntity)
      .values({
        id: uuidv7(),
        ...input,
        advertiserId: input.advertiserId ?? null,
        portalKey: input.portalKey ?? null,
        occurredAt: input.occurredAt ?? null,
        status: 'received',
        errorCode: null,
      } as QueryDeepPartialEntity<WebhookEventEntity>)
      .orIgnore()
      .returning(['id'])
      .execute();
    const raw: unknown = insert.raw;
    const created = Array.isArray(raw) ? (raw[0] as { id?: string } | undefined) : undefined;
    if (created?.id) return { eventId: created.id, duplicate: false };

    const existing = await tx.getRepository(WebhookEventEntity).findOne({
      where: {
        provider: input.provider,
        providerMode: input.providerMode,
        scopeKey: input.scopeKey,
        eventKey: input.eventKey,
      },
    });
    if (!existing) throw new Error('Webhook event conflict did not resolve to an existing event');
    if (existing.payloadHash !== input.payloadHash) {
      throw new ConflictException('Webhook event key was reused with a different payload');
    }
    return { eventId: existing.id, duplicate: true };
  }
}
