import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '../../../core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '../../../core/queue/types/worker.types.js';
import { LeadIngestService } from '../services/lead-ingest.service.js';

@Injectable()
export class TiktokIngestHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ingest: LeadIngestService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource.getRepository(OperationEntity).findOne({
      where: { id: context.operationId },
    });
    const eventId = operation?.payload.eventId;
    if (!eventId) return { outcome: 'quarantined', errorCode: 'EVENT_ID_MISSING' };
    const result = await this.ingest.process(eventId, context);
    if (result.outcome === 'quarantined') return result;
    return { outcome: 'succeeded' };
  }
}
