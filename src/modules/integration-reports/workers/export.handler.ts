import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '@core/queue/types/worker.types.js';
import { ExportService } from '../services/export.service.js';

/** Runs the report job referenced by an `integration_report` operation. */
@Injectable()
export class ExportHandler implements OperationHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly exportService: ExportService,
  ) {}

  async handle(context: OperationContext): Promise<OperationOutcome> {
    const operation = await this.dataSource
      .getRepository(OperationEntity)
      .findOne({ where: { id: context.operationId } });
    const jobId = operation?.payload.reportJobId;
    if (!jobId) return { outcome: 'quarantined', errorCode: 'REPORT_PAYLOAD_INVALID' };
    return this.exportService.execute(jobId, context);
  }
}
