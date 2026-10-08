import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import type { DataSource, DeepPartial } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { DealEntity } from '../entities/deal.entity.js';
import { DealPollCheckpointEntity } from '../entities/deal-poll-checkpoint.entity.js';

@Injectable()
export class DealPollRepository {
  constructor(@InjectDataSource('tiktok') private readonly dataSource: DataSource) {}

  async checkpoint(portalKey: string): Promise<DealPollCheckpointEntity> {
    const repository = this.dataSource.getRepository(DealPollCheckpointEntity);
    const existing = await repository.findOne({ where: { portalKey } });
    return (
      existing ??
      repository.save({
        id: uuidv7(),
        portalKey,
        incrementalWatermark: null,
        fullScanAt: null,
        activeMode: null,
        pageOffset: 0,
      })
    );
  }

  saveCheckpoint(
    checkpoint: DeepPartial<DealPollCheckpointEntity>,
  ): Promise<DealPollCheckpointEntity> {
    return this.dataSource.getRepository(DealPollCheckpointEntity).save(checkpoint);
  }

  async listManagedPage(portalKey: string, offset: number, limit: number): Promise<DealEntity[]> {
    return this.dataSource.getRepository(DealEntity).find({
      where: { portalKey, bitrixDealId: Not(IsNull()) },
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });
  }

  isManaged(portalKey: string, remoteId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(DealEntity)
      .exists({ where: { portalKey, bitrixDealId: remoteId } });
  }

  hasLocalId(portalKey: string, localId: string): Promise<boolean> {
    return this.dataSource.getRepository(DealEntity).exists({ where: { portalKey, id: localId } });
  }
}
