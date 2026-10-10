import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { DealEntity } from '../entities/deal.entity.js';
import { LeadEntity } from '../entities/lead.entity.js';
import { IntegrationReadRepository } from '../repositories/integration-read.repository.js';

describe('IntegrationReadRepository', () => {
  it('builds filtered and unfiltered lead, deal, and operation lists with stable paging', async () => {
    const builder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn(() => builder),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const dataSource = { getRepository: jest.fn(() => repository) };
    const reader = new IntegrationReadRepository(dataSource as never);

    await reader.listLeads({
      page: 2,
      limit: 10,
      campaign_id: 'campaign',
      sync_status: 'synced',
      business_status: 'new',
      from: '2026-01-01',
      to: '2026-01-31',
    } as never);
    expect(dataSource.getRepository).toHaveBeenCalledWith(LeadEntity);
    expect(builder.andWhere).toHaveBeenCalledTimes(5);
    expect(builder.skip).toHaveBeenLastCalledWith(10);
    expect(builder.take).toHaveBeenLastCalledWith(10);

    builder.andWhere.mockClear();
    await reader.listLeads({ page: 1, limit: 5 } as never);
    expect(builder.andWhere).not.toHaveBeenCalled();

    builder.andWhere.mockClear();
    await reader.listDeals({ page: 3, limit: 20, status: 'won', assigned_to: 'sales-1' } as never);
    expect(dataSource.getRepository).toHaveBeenCalledWith(DealEntity);
    expect(builder.andWhere).toHaveBeenCalledTimes(2);
    expect(builder.skip).toHaveBeenLastCalledWith(40);
    builder.andWhere.mockClear();
    await reader.listDeals({ page: 1, limit: 10 });
    expect(builder.andWhere).not.toHaveBeenCalled();

    await expect(reader.getOperation('op-1')).resolves.toBeNull();
    expect(dataSource.getRepository).toHaveBeenCalledWith(OperationEntity);
    builder.andWhere.mockClear();
    await reader.listOperations({ page: 2, limit: 5, status: 'failed' } as never);
    expect(builder.andWhere).toHaveBeenCalledWith('operation.status = :status', {
      status: 'failed',
    });
    builder.andWhere.mockClear();
    await reader.listOperations({ page: 1, limit: 5 });
    expect(builder.andWhere).not.toHaveBeenCalled();
  });
});
