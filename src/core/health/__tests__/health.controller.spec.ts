import { Test } from '@nestjs/testing';

import { HealthController } from '../controllers/health.controller.js';
import { HealthService } from '../services/health.service.js';
import type { HealthResponse } from '../types/index.js';

describe('HealthController', () => {
  let controller: HealthController;
  const healthService = { check: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('check', () => {
    it('should return the service result when called', async () => {
      const response: HealthResponse = {
        status: 'ok',
        database: 'up',
        uptime: 1.5,
        timestamp: '2026-10-04T15:00:00.000Z',
      };
      healthService.check.mockResolvedValue(response);

      await expect(controller.check()).resolves.toBe(response);
    });
  });
});
