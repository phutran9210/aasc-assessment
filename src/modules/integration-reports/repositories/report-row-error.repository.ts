import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { ReportRowErrorEntity } from '../entities/report-row-error.entity.js';

export type RowErrorInput = {
  rowNumber: number;
  sourceKey: string | null;
  errorCode: string;
  /** Field or rule that failed; never the rejected value itself. */
  redactedDetail?: string | null;
};

@Injectable()
export class ReportRowErrorRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Idempotent per (job,row): a chunk replayed after a crash records each row error once. */
  async record(
    reportJobId: string,
    errors: RowErrorInput[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    if (!errors.length) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(ReportRowErrorEntity)
      .values(
        errors.map((error) => ({
          id: uuidv7(),
          reportJobId,
          rowNumber: error.rowNumber,
          sourceKey: error.sourceKey?.slice(0, 255) ?? null,
          errorCode: error.errorCode,
          redactedDetail: error.redactedDetail ?? null,
        })),
      )
      .orIgnore()
      .execute();
  }

  list(reportJobId: string, limit = 100): Promise<ReportRowErrorEntity[]> {
    return this.dataSource.getRepository(ReportRowErrorEntity).find({
      where: { reportJobId },
      order: { rowNumber: 'ASC' },
      take: limit,
    });
  }
}
