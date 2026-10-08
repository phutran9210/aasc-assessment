import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { LeadSyncPendingLead } from '../entities/lead-sync-pending-lead.entity.js';

/** Queue of lead IDs waiting to be pulled; one row per lead however many events named it. */
@Injectable()
export class LeadSyncPendingLeadRepository extends BaseRepository<LeadSyncPendingLead> {
  constructor(dataSource: DataSource) {
    super(dataSource, LeadSyncPendingLead);
  }

  async add(leadId: number): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ id: uuidv7(), leadId })
      .orIgnore()
      .execute();
  }

  async leadIds(): Promise<number[]> {
    const rows = await this.repo.find({ order: { leadId: 'ASC' } });
    return rows.map((row) => row.leadId);
  }

  async removeLeads(leadIds: number[]): Promise<void> {
    if (leadIds.length) await this.repo.delete({ leadId: In(leadIds) });
  }
}
