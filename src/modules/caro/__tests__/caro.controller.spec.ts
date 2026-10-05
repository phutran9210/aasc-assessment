import { CaroController } from '../controllers/caro.controller.js';
import type { CaroMatchService } from '../services/caro-match.service.js';

describe('CaroController', () => {
  const matchService = { findHistory: jest.fn() };
  let controller: CaroController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new CaroController(matchService as unknown as CaroMatchService);
  });

  it('should return the authenticated player history', async () => {
    const page = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    matchService.findHistory.mockResolvedValue(page);

    await expect(
      controller.findHistory({ id: 'user-1', username: 'alice' }, { page: 1, limit: 20 }),
    ).resolves.toBe(page);
    expect(matchService.findHistory).toHaveBeenCalledWith('user-1', { page: 1, limit: 20 });
  });
});
