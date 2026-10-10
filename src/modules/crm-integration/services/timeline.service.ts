import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { OperationContext, OperationOutcome } from '@core/queue/types/worker.types.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import { TimelineRepository } from '../repositories/timeline.repository.js';
import type { TimelineInput } from '../ports/crm-gateway.port.js';
import type { CrmGateway } from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import { RemoteReconciliationService } from './remote-reconciliation.service.js';
import { TIMELINE_RETRY_DELAYS_MS } from '../constants/flow.constants.js';

@Injectable()
export class TimelineService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly reconciliation: RemoteReconciliationService,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly timelines: TimelineRepository,
  ) {}

  async append(
    input: TimelineInput & { leadId: string },
    context: OperationContext,
    manager?: EntityManager,
  ): Promise<string> {
    if (manager) return this.appendInTransaction(input, context, manager);
    return this.dataSource.transaction((tx) => this.appendInTransaction(input, context, tx));
  }

  async execute(timelineId: string, context: OperationContext): Promise<OperationOutcome> {
    await context.assertOwnership();
    const timeline = await this.timelines.findById(timelineId, this.dataSource.manager);
    if (!timeline) return { outcome: 'quarantined', errorCode: 'TIMELINE_NOT_FOUND' };

    try {
      const result = await this.reconciliation.find('timeline', timeline.marker, {
        entityType: timeline.entityType,
        entityId: timeline.remoteEntityId ?? '',
      });
      if (result.status === 'ambiguous') {
        await this.timelines.update(
          timeline.id,
          {
            status: 'reconcile_required',
            lastErrorCode: 'TIMELINE_MARKER_AMBIGUOUS',
          },
          this.dataSource.manager,
        );
        return { outcome: 'reconcile_required', errorCode: 'TIMELINE_MARKER_AMBIGUOUS' };
      }
      if (result.status === 'found') {
        await this.markPosted(timeline.id, result.value.id);
        return { outcome: 'succeeded' };
      }

      await context.assertOwnership();
      const created = await this.gateway.addTimeline({
        entityType: timeline.entityType,
        entityId: timeline.remoteEntityId ?? '',
        marker: timeline.marker,
        comment: timeline.comment,
      });
      await this.markPosted(timeline.id, created.id);
      return { outcome: 'succeeded' };
    } catch {
      return this.scheduleReconciliation(timeline.id, context);
    }
  }

  private async appendInTransaction(
    input: TimelineInput & { leadId: string },
    context: OperationContext,
    manager: EntityManager,
  ): Promise<string> {
    const marker = input.marker || `aasc-tiktok/timeline/${input.leadId}/${input.entityId}`;
    let timeline = await this.timelines.findByMarker(marker, manager);
    if (!timeline) {
      timeline = await this.timelines.save(
        {
          id: uuidv7(),
          leadId: input.leadId,
          entityType: input.entityType,
          remoteEntityId: input.entityId,
          marker,
          comment: input.comment,
          status: 'pending',
          attempt: 0,
          nextAttemptAt: null,
          lastErrorCode: null,
        },
        manager,
      );
    }
    const operation = await this.operations.ensure(
      {
        operationKey: `crm-timeline/${timeline.id}/0`,
        kind: OPERATION_KINDS.crmTimeline,
        aggregateId: timeline.leadId,
        payload: { timelineId: timeline.id },
        configRevisions: context.revisions,
      },
      manager,
    );
    if (operation.status === 'pending') {
      if (!(await this.outbox.hasUnpublished(operation.id, manager)))
        await this.outbox.append(operation.id, QUEUE_NAMES.bitrixLeadSync, new Date(), manager);
    }
    return timeline.id;
  }

  private async markPosted(timelineId: string, remoteId: string): Promise<void> {
    await this.timelines.update(
      timelineId,
      {
        remoteTimelineId: remoteId,
        status: 'posted',
        nextAttemptAt: null,
        lastErrorCode: null,
      },
      this.dataSource.manager,
    );
  }

  private async scheduleReconciliation(
    timelineId: string,
    context: OperationContext,
  ): Promise<OperationOutcome> {
    const nextAttempt = await this.dataSource.transaction(async (manager) => {
      const timeline = await this.timelines.findByIdForUpdate(timelineId, manager);
      if (!timeline) return null;
      const attempt = timeline.attempt + 1;
      if (attempt > TIMELINE_RETRY_DELAYS_MS.length) {
        timeline.status = 'reconcile_required';
        timeline.nextAttemptAt = null;
        timeline.lastErrorCode = 'TIMELINE_RECONCILIATION_EXHAUSTED';
        await this.timelines.save(timeline, manager);
        return { exhausted: true as const };
      }
      timeline.attempt = attempt;
      timeline.status = 'pending';
      const delayMs = TIMELINE_RETRY_DELAYS_MS[attempt - 1] ?? TIMELINE_RETRY_DELAYS_MS[0];
      timeline.nextAttemptAt = new Date(Date.now() + (delayMs ?? 5_000));
      timeline.lastErrorCode = 'TIMELINE_MUTATION_AMBIGUOUS';
      await this.timelines.save(timeline, manager);
      const operation = await this.operations.ensure(
        {
          operationKey: `crm-timeline/${timeline.id}/${attempt}`,
          kind: OPERATION_KINDS.crmTimeline,
          aggregateId: timeline.leadId,
          payload: { timelineId: timeline.id },
          configRevisions: context.revisions,
        },
        manager,
      );
      await this.outbox.append(
        operation.id,
        QUEUE_NAMES.bitrixLeadSync,
        timeline.nextAttemptAt,
        manager,
      );
      return { exhausted: false as const };
    });
    return nextAttempt?.exhausted
      ? { outcome: 'reconcile_required', errorCode: 'TIMELINE_RECONCILIATION_EXHAUSTED' }
      : { outcome: 'reconcile_required', errorCode: 'TIMELINE_MUTATION_AMBIGUOUS' };
  }
}
