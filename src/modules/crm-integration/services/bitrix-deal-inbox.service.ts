import { createHash, timingSafeEqual } from 'node:crypto';

import { BadRequestException, UnauthorizedException, Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BITRIX_INSTALLATION_STORE } from '@modules/bitrix/ports/bitrix-installation-store.port.js';
import type { BitrixInstallationStore } from '@modules/bitrix/ports/bitrix-installation-store.port.js';
import { BitrixApiService } from '@modules/bitrix/services/bitrix-api.service.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { parseBitrixDealEvent } from '../domain/bitrix-event-envelope.js';
import type { BitrixInboxReceipt } from '../types/bitrix-inbox-receipt.type.js';

@Injectable()
export class BitrixDealInbox {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: WebhookEventRepository,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly api: BitrixApiService,
    @Inject(BITRIX_INSTALLATION_STORE) private readonly installations: BitrixInstallationStore,
  ) {}

  async receive(
    raw: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<BitrixInboxReceipt> {
    let envelope: ReturnType<typeof parseBitrixDealEvent>;
    try {
      envelope = parseBitrixDealEvent(raw);
    } catch {
      throw new BadRequestException('Invalid Bitrix deal event');
    }
    const config = validateTiktokEnv(process.env);
    const providerMode = config.bitrixMode === 'mock' ? 'mock' : 'real';
    await this.authenticate(envelope, headers, config, providerMode);

    // Never persist callback credentials or arbitrary upstream fields.
    const payload = {
      eventType: envelope.eventType,
      remoteId: envelope.remoteId,
      timestamp: envelope.timestamp.toISOString(),
    };
    const safeRaw = Buffer.from(JSON.stringify(payload));
    const payloadHash = createHash('sha256').update(safeRaw).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const accepted = await this.events.accept(
        {
          provider: 'bitrix24',
          providerMode,
          scopeKey: config.portalKey,
          portalKey: config.portalKey,
          eventKey: envelope.eventKey,
          eventType: envelope.eventType,
          occurredAt: envelope.timestamp,
          rawBody: safeRaw,
          payload,
          payloadHash,
        },
        manager,
      );
      const operation = await this.operations.ensure(
        {
          operationKey: `bitrix-deal-event/${config.portalKey}/${accepted.eventId}`,
          kind: OPERATION_KINDS.bitrixDealRefresh,
          payload: { eventId: accepted.eventId, remoteId: envelope.remoteId },
        },
        manager,
      );
      if (!accepted.duplicate && operation.status === 'pending')
        await this.outbox.append(operation.id, QUEUE_NAMES.bitrixDealRefresh, new Date(), manager);
      return {
        eventId: accepted.eventId,
        operationId: operation.id,
        duplicate: accepted.duplicate,
      };
    });
  }

  private async authenticate(
    event: ReturnType<typeof parseBitrixDealEvent>,
    headers: Record<string, string | string[] | undefined>,
    config: ReturnType<typeof validateTiktokEnv>,
    mode: 'mock' | 'real',
  ): Promise<void> {
    if (mode === 'mock') {
      if (
        event.mockPortalKey !== config.portalKey ||
        !safeEqual(header(headers, 'x-mock-bitrix-secret'), config.bitrixMockEventSecret)
      )
        throw new UnauthorizedException('Invalid Bitrix mock callback credentials');
      return;
    }

    if (event.mockPortalKey)
      throw new UnauthorizedException('Mock Bitrix callback format is disabled in real mode');

    if (this.api.mode === 'webhook') {
      const token = config.bitrixOutgoingEventToken;
      if (!token || !safeEqual(header(headers, 'x-bitrix-outgoing-token'), token))
        throw new UnauthorizedException('Invalid Bitrix outgoing callback credential');
      return;
    }

    const installation = await this.installations.findCurrent();
    if (
      !installation ||
      !event.applicationToken ||
      !event.domain ||
      !event.memberId ||
      normalizeDomain(installation.domain) !== normalizeDomain(event.domain) ||
      installation.memberId !== event.memberId ||
      !(await this.api.verifyApplicationToken(event.applicationToken))
    )
      throw new UnauthorizedException('Bitrix callback does not match the installed portal');
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\/$/, '');
}
