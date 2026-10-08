import { createHash } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { AnalyticsRevisionEntity } from '@modules/integration-analytics/entities/analytics-revision.entity.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import type { CrmGateway, CrmMetadata, RemoteDeal } from '../ports/crm-gateway.port.js';
import { DealEntity } from '../entities/deal.entity.js';
import { DealHistoryRepository } from '../repositories/deal-history.repository.js';
import { ConversionFeedbackService } from '@modules/tiktok/services/conversion-feedback.service.js';

@Injectable()
export class DealRefreshService {
  private metadataCache: { expiresAt: number; value: CrmMetadata } | null = null;
  private metadataPending: Promise<CrmMetadata> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly history: DealHistoryRepository,
    private readonly feedback?: ConversionFeedbackService,
  ) {}

  async refresh(remoteId: string, context: OperationContext): Promise<OperationOutcome> {
    if (!remoteId) return { outcome: 'quarantined', errorCode: 'DEAL_REMOTE_ID_MISSING' };
    const lease = await context.acquireAggregateLease(`deal/${remoteId}`);
    if (!lease)
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(Date.now() + 5_000),
        errorCode: 'DEAL_REFRESH_LEASE_BUSY',
      };

    try {
      await context.assertOwnership();
      const operation = await this.dataSource.getRepository(OperationEntity).findOne({
        where: { id: context.operationId },
      });
      const event = operation?.payload.eventId
        ? await this.dataSource.getRepository(WebhookEventEntity).findOne({
            where: { id: operation.payload.eventId },
          })
        : null;
      const eventType = event?.eventType;
      if (eventType === 'deal.delete') return this.tombstone(remoteId, event, context);

      let remote: RemoteDeal;
      try {
        remote = await this.gateway.getDeal(remoteId);
      } catch (error) {
        if (error instanceof NotFoundException && eventType === 'deal.delete')
          return this.tombstone(remoteId, event, context);
        throw error;
      }
      const deal = await this.findManagedDeal(remote, remoteId);
      if (!deal) {
        if (event)
          await this.dataSource
            .getRepository(WebhookEventEntity)
            .update(event.id, { status: 'ignored' });
        return { outcome: 'succeeded', remoteId };
      }

      let snapshot = await this.snapshot(remote);
      const current = await this.dataSource
        .getRepository(DealEntity)
        .findOne({ where: { id: deal.id } });
      if (
        current?.remoteModifiedAt &&
        snapshot.modifiedAt &&
        current.remoteModifiedAt.getTime() === snapshot.modifiedAt.getTime() &&
        current.currentSnapshotHash !== snapshot.hash
      ) {
        // Bitrix timestamps have second precision. Re-read while holding the deal lease to
        // distinguish a duplicate event from two writes in the same second.
        await context.assertOwnership();
        remote = await this.gateway.getDeal(remoteId);
        snapshot = await this.snapshot(remote);
      }

      await context.assertOwnership();
      const changed = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(DealEntity);
        const locked = await repository.findOne({
          where: { id: deal.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) return false;
        if (
          locked.remoteModifiedAt &&
          snapshot.modifiedAt &&
          snapshot.modifiedAt.getTime() < locked.remoteModifiedAt.getTime()
        ) {
          if (event)
            await manager
              .getRepository(WebhookEventEntity)
              .update(event.id, { status: 'processed' });
          return false;
        }
        if (locked.currentSnapshotHash === snapshot.hash) {
          await repository.update(locked.id, {
            ...(locked.bitrixDealId ? {} : { bitrixDealId: remote.id }),
            ...(snapshot.modifiedAt &&
            (!locked.remoteModifiedAt || snapshot.modifiedAt > locked.remoteModifiedAt)
              ? { remoteModifiedAt: snapshot.modifiedAt }
              : {}),
          });
          if (event)
            await manager
              .getRepository(WebhookEventEntity)
              .update(event.id, { status: 'processed' });
          return false;
        }

        const observedAt = new Date();
        const semantics = snapshot.stageSemantics;
        const previousSemantics = locked.stageSemantics;
        await repository.update(locked.id, {
          bitrixDealId: remote.id,
          title: remote.title || locked.title,
          amount: snapshot.amount,
          currency: snapshot.currency,
          pipelineId: snapshot.pipelineId,
          stageId: snapshot.stageId,
          stageSemantics: semantics,
          probability: semantics === 'won' ? 100 : semantics === 'lost' ? 0 : snapshot.probability,
          assignedTo: snapshot.assignedTo,
          remoteModifiedAt: snapshot.modifiedAt ?? locked.remoteModifiedAt,
          everWonAt:
            semantics === 'won'
              ? (locked.everWonAt ?? snapshot.modifiedAt ?? observedAt)
              : locked.everWonAt,
          currentSnapshotHash: snapshot.hash,
          stageDeletedAt: null,
          version: () => 'version + 1',
        });
        await this.history.record(
          {
            dealId: locked.id,
            previousStageId: locked.stageId,
            currentStageId: snapshot.stageId,
            previousSemantics,
            currentSemantics: semantics,
            amount: snapshot.amount,
            currency: snapshot.currency,
            providerRevisionKey: `snapshot:${snapshot.modifiedAt?.toISOString() ?? 'unknown'}:${snapshot.hash}`,
            observedAt,
            effectiveAt: snapshot.modifiedAt ?? observedAt,
            sourceComplete: snapshot.modifiedAt !== null,
          },
          manager,
        );
        if (semantics === 'won') await this.feedback?.schedule(locked.leadId, 'deal_won', manager);
        await manager
          .createQueryBuilder()
          .update(AnalyticsRevisionEntity)
          .set({ revision: () => 'revision + 1' })
          .where('id = :id', { id: '00000000-0000-7000-8000-000000000001' })
          .execute();
        if (event)
          await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
        return true;
      });
      return { outcome: 'succeeded', remoteId: changed ? remote.id : remoteId };
    } catch {
      return {
        outcome: 'retry_wait',
        nextAttemptAt: new Date(Date.now() + 5_000),
        errorCode: 'DEAL_REFRESH_FAILED',
      };
    } finally {
      await context.releaseAggregateLease(lease);
    }
  }

  private async findManagedDeal(remote: RemoteDeal, remoteId: string): Promise<DealEntity | null> {
    const repository = this.dataSource.getRepository(DealEntity);
    const linked = await repository.findOne({
      where: { portalKey: process.env.BITRIX_PORTAL_KEY ?? 'mock-portal', bitrixDealId: remoteId },
    });
    if (linked) return linked;
    const match = remote.marker?.match(/^aasc-tiktok\/deal\/([0-9a-f-]{36})$/i);
    if (!match) return null;
    const local = await repository.findOne({ where: { id: match[1] } });
    return local ?? null;
  }

  private async snapshot(remote: RemoteDeal) {
    const fields = remote.fields;
    const stageId = text(fields.stageId ?? fields.STAGE_ID);
    const pipelineId = text(fields.categoryId ?? fields.CATEGORY_ID);
    if (!stageId || !pipelineId) throw new Error('Bitrix deal snapshot has no stage or category');
    const metadata = await this.metadata();
    const stage = metadata.stages.find(
      (item) => item.id === stageId && String(item.categoryId) === pipelineId,
    );
    const rawSemantic = stage?.semantic?.toUpperCase();
    const stageSemantics: DealEntity['stageSemantics'] =
      rawSemantic === 'WON' || rawSemantic === 'S'
        ? 'won'
        : rawSemantic === 'LOST' || rawSemantic === 'F'
          ? 'lost'
          : 'open';
    const modifiedAt = parseDate(fields.updatedTime ?? fields.DATE_MODIFY ?? fields.dateModify);
    const amount = decimal(fields.opportunity ?? fields.OPPORTUNITY);
    const currency = text(fields.currencyId ?? fields.CURRENCY_ID);
    const assignedTo = text(fields.assignedById ?? fields.ASSIGNED_BY_ID) ?? null;
    const probability =
      integer(fields.probability ?? fields.PROBABILITY, 0, 100) ??
      (stageSemantics === 'won' ? 100 : stageSemantics === 'lost' ? 0 : 0);
    const content = {
      remoteId: remote.id,
      title: remote.title,
      stageId,
      pipelineId,
      stageSemantics,
      amount,
      currency,
      assignedTo,
      probability,
    };
    const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    return {
      stageId,
      pipelineId,
      stageSemantics,
      modifiedAt,
      amount,
      currency,
      assignedTo,
      probability,
      hash,
    };
  }

  private async metadata(): Promise<CrmMetadata> {
    if (this.metadataCache && this.metadataCache.expiresAt > Date.now())
      return this.metadataCache.value;
    if (!this.metadataPending) {
      this.metadataPending = this.gateway
        .metadata()
        .then((value) => {
          this.metadataCache = { expiresAt: Date.now() + 5 * 60 * 1000, value };
          return value;
        })
        .finally(() => {
          this.metadataPending = null;
        });
    }
    return this.metadataPending;
  }

  private async tombstone(
    remoteId: string,
    event: WebhookEventEntity | null,
    context: OperationContext,
  ): Promise<OperationOutcome> {
    const deal = await this.dataSource.getRepository(DealEntity).findOne({
      where: { portalKey: process.env.BITRIX_PORTAL_KEY ?? 'mock-portal', bitrixDealId: remoteId },
    });
    if (!deal) {
      if (event)
        await this.dataSource
          .getRepository(WebhookEventEntity)
          .update(event.id, { status: 'ignored' });
      return { outcome: 'succeeded', remoteId };
    }
    if (deal.stageDeletedAt) {
      if (event)
        await this.dataSource
          .getRepository(WebhookEventEntity)
          .update(event.id, { status: 'processed' });
      return { outcome: 'succeeded', remoteId };
    }
    await context.assertOwnership();
    await this.dataSource.transaction(async (manager) => {
      const observedAt = new Date();
      await manager
        .getRepository(DealEntity)
        .update(deal.id, { stageDeletedAt: observedAt, version: () => 'version + 1' });
      const inserted = await this.history.record(
        {
          dealId: deal.id,
          previousStageId: deal.stageId,
          currentStageId: deal.stageId,
          previousSemantics: deal.stageSemantics,
          currentSemantics: deal.stageSemantics,
          amount: deal.amount,
          currency: deal.currency,
          providerRevisionKey: `delete:${event?.eventKey ?? remoteId}`,
          observedAt,
          effectiveAt: event?.occurredAt ?? observedAt,
          sourceComplete: Boolean(event),
        },
        manager,
      );
      if (inserted)
        await manager
          .createQueryBuilder()
          .update(AnalyticsRevisionEntity)
          .set({ revision: () => 'revision + 1' })
          .where('id = :id', { id: '00000000-0000-7000-8000-000000000001' })
          .execute();
      if (event)
        await manager.getRepository(WebhookEventEntity).update(event.id, { status: 'processed' });
    });
    return { outcome: 'succeeded', remoteId };
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result || null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function decimal(value: unknown): string | null {
  const valueText = text(value);
  return valueText && /^-?\d+(?:\.\d{1,4})?$/.test(valueText) ? valueText : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}
