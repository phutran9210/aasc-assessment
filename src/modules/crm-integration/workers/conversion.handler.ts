import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '../../../core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '../../../core/queue/types/worker.types.js';
import { ConversionService } from '../services/conversion.service.js';

@Injectable()
export class ConversionHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly conversions: ConversionService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    if (!operation?.payload.leadId)
      return { outcome: 'quarantined', errorCode: 'CONVERSION_PAYLOAD_INVALID' };
    return this.conversions.execute(context.operationId, context);
  }
}
