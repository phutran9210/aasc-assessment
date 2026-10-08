import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '../../../core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '../../../core/queue/types/worker.types.js';
import { LeadSyncService } from '../services/lead-sync.service.js';

@Injectable()
export class LeadSyncHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly syncService: LeadSyncService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    const leadId = operation?.payload.leadId;
    const targetVersion = operation?.targetVersion ?? operation?.payload.targetVersion;
    if (!leadId || !targetVersion)
      return { outcome: 'quarantined', errorCode: 'LEAD_SYNC_PAYLOAD_INVALID' };
    return this.syncService.sync(
      leadId,
      targetVersion,
      context,
      operation?.payload.reconciliationAttempt ?? 0,
    );
  }
}
