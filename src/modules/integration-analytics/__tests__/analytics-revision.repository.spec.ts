import type { EntityManager } from 'typeorm';

import { AnalyticsRevisionRepository } from '../repositories/analytics-revision.repository.js';

describe('AnalyticsRevisionRepository', () => {
  it('increments the singleton revision using the active transaction manager', async () => {
    const query = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const manager = { createQueryBuilder: () => query } as unknown as EntityManager;

    await new AnalyticsRevisionRepository().increment(manager);

    expect(query.update).toHaveBeenCalledTimes(1);
    expect(query.set).toHaveBeenCalledWith({ revision: expect.any(Function) });
    expect(query.where).toHaveBeenCalledWith('id = :id', {
      id: '00000000-0000-7000-8000-000000000001',
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
  });
});
