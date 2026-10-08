import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '../../../core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '../../../core/queue/types/worker.types.js';
import { DealRefreshService } from '../services/deal-refresh.service.js';

@Injectable()
export class DealRefreshHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly refreshes: DealRefreshService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    if (!operation?.payload.remoteId)
      return { outcome: 'quarantined', errorCode: 'DEAL_REFRESH_PAYLOAD_INVALID' };
    return this.refreshes.refresh(operation.payload.remoteId, context);
  }
}
