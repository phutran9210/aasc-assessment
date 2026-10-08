import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { ERROR_MESSAGE_MAX_LENGTH } from '../constants/index.js';
import type { RunItemAction } from '../constants/index.js';
import { chunk } from '../domain/chunk.js';
import { LeadSyncRunItem } from '../entities/lead-sync-run-item.entity.js';
import type { RunItemInput } from '../types/index.js';

// Keeps one INSERT well below the SQLite limit on bound parameters.
const INSERT_CHUNK = 100;

@Injectable()
export class LeadSyncRunItemRepository extends BaseRepository<LeadSyncRunItem> {
  constructor(dataSource: DataSource) {
    super(dataSource, LeadSyncRunItem);
  }

  async addMany(runId: string, items: RunItemInput[]): Promise<void> {
    for (const group of chunk(items, INSERT_CHUNK)) {
      await this.repo.insert(
        group.map((item) => ({
          id: uuidv7(),
          runId,
          rowNumber: item.rowNumber,
          action: item.action,
          leadId: item.leadId === undefined ? null : String(item.leadId),
          errorCode: item.errorCode ?? null,
          errorMessage: item.errorMessage?.slice(0, ERROR_MESSAGE_MAX_LENGTH) ?? null,
          attempts: item.attempts ?? 1,
        })),
      );
    }
  }

  findByRun(runId: string, action?: RunItemAction): Promise<LeadSyncRunItem[]> {
    return this.repo.find({
      where: action ? { runId, action } : { runId },
      order: { rowNumber: 'ASC', id: 'ASC' },
    });
  }

  async deleteByRunIds(runIds: string[]): Promise<void> {
    if (runIds.length) await this.repo.delete({ runId: In(runIds) });
  }
}
