import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { DataSource, EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { ReportJobEntity } from '../entities/report-job.entity.js';

export const ACTIVE_REPORT_JOB_STATUSES = ['pending', 'running'];

@Injectable()
export class ReportJobRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    values: QueryDeepPartialEntity<ReportJobEntity> & { id: string },
    manager: EntityManager,
  ): Promise<ReportJobEntity> {
    await manager.getRepository(ReportJobEntity).insert(values);
    return manager.getRepository(ReportJobEntity).findOneByOrFail({ id: values.id });
  }

  /** Loads a job including its artifact path, which is never selected by default. */
  findById(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ReportJobEntity | null> {
    return manager
      .getRepository(ReportJobEntity)
      .createQueryBuilder('job')
      .addSelect('job.artifactPath')
      .where('job.id = :id', { id })
      .getOne();
  }

  /** Serializes job creation per requester for the rest of the transaction. */
  async lockRequester(requesterId: string, manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `report-job-requester/${requesterId}`,
    ]);
  }

  countActive(
    requesterId: string,
    kind: ReportJobEntity['kind'],
    manager: EntityManager,
  ): Promise<number> {
    return manager
      .getRepository(ReportJobEntity)
      .count({ where: { requesterId, kind, status: In(ACTIVE_REPORT_JOB_STATUSES) } });
  }

  async update(
    id: string,
    patch: QueryDeepPartialEntity<ReportJobEntity>,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    await manager.getRepository(ReportJobEntity).update(id, patch);
  }

  /** Records the finalized artifact; this row is the only thing that makes a file downloadable. */
  async complete(
    id: string,
    result: {
      artifactPath: string;
      artifactHash: string;
      totalRows: number;
      snapshotAt: Date;
      expiresAt: Date;
    },
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    await manager.getRepository(ReportJobEntity).update(id, {
      status: 'completed',
      artifactPath: result.artifactPath,
      artifactHash: result.artifactHash,
      totalRows: result.totalRows,
      successRows: result.totalRows,
      failedRows: 0,
      snapshotAt: result.snapshotAt,
      expiresAt: result.expiresAt,
      errorSummary: null,
    });
  }
}
