import { DataSource } from 'typeorm';

import { LeadSyncPendingLead } from '../entities/lead-sync-pending-lead.entity.js';
import { LeadSyncPendingLeadRepository } from '../repositories/lead-sync-pending-lead.repository.js';

describe('LeadSyncPendingLeadRepository', () => {
  let dataSource: DataSource;
  let queue: LeadSyncPendingLeadRepository;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [LeadSyncPendingLead],
      synchronize: true,
    });
    await dataSource.initialize();
    queue = new LeadSyncPendingLeadRepository(dataSource);
  });

  afterEach(() => dataSource.destroy());

  it('should keep one entry per lead however many times it is added', async () => {
    await queue.add(12);
    await queue.add(10);
    await queue.add(12);

    await expect(queue.leadIds()).resolves.toEqual([10, 12]);
  });

  it('should remove only the leads that were pulled', async () => {
    await queue.add(10);
    await queue.add(12);

    await queue.removeLeads([10]);
    await queue.removeLeads([]);

    await expect(queue.leadIds()).resolves.toEqual([12]);
  });
});
