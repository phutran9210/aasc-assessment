import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '@core/queue/types/worker.types.js';
import { TimelineService } from '../services/timeline.service.js';

@Injectable()
export class TimelineHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly timeline: TimelineService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    const timelineId = operation?.payload.timelineId;
    if (!timelineId) return { outcome: 'quarantined', errorCode: 'TIMELINE_PAYLOAD_INVALID' };
    return this.timeline.execute(timelineId, context);
  }
}
