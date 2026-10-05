import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DataSource } from 'typeorm';

import { HealthService } from '../services/health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  const dataSource = { query: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  describe('check', () => {
    it('should report ok and database up when the database answers', async () => {
      dataSource.query.mockResolvedValue([{ 1: 1 }]);

      const result = await service.check();

      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
      expect(result).toEqual({
        status: 'ok',
        database: 'up',
        uptime: expect.any(Number),
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      });
    });

    it('should throw ServiceUnavailableException when the database query fails', async () => {
      const failure = new Error('SQLITE_CANTOPEN');
      dataSource.query.mockRejectedValue(failure);

      const check = service.check();

      await expect(check).rejects.toThrow(ServiceUnavailableException);
      await expect(check).rejects.toThrow('Không thể kết nối cơ sở dữ liệu');
      await expect(check).rejects.toHaveProperty('cause', failure);
    });
  });
});
