import type { DataSource } from 'typeorm';

import { BitrixInstallationRepository } from '../repositories/bitrix-installation.repository.js';
import type { BitrixTokenSet } from '../types/index.js';

const TOKEN_SET: BitrixTokenSet = {
  memberId: 'member-1',
  domain: 'portal.bitrix24.com',
  clientEndpoint: 'https://portal.bitrix24.com/rest/',
  serverEndpoint: 'https://oauth.bitrix.info/rest/',
  scope: 'crm',
  status: 'L',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  applicationToken: 'application-1',
  expiresIn: 3600,
};

describe('BitrixInstallationRepository', () => {
  const repository = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
  const dataSource = { getRepository: jest.fn(() => repository) };
  let service: BitrixInstallationRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    dataSource.getRepository = jest.fn(() => repository);
    repository.create.mockImplementation((value) => value);
    service = new BitrixInstallationRepository(dataSource as unknown as DataSource);
  });

  it('should return null when no installation is stored', async () => {
    repository.find.mockResolvedValue([]);

    await expect(service.findCurrent()).resolves.toBeNull();
    expect(repository.find).toHaveBeenCalledWith({ order: { updatedAt: 'DESC' }, take: 1 });
  });

  it('should store an installation and return it', async () => {
    repository.find.mockResolvedValue([]);
    repository.save.mockImplementation((value) => ({ id: 'id-1', ...value }));

    const result = await service.saveTokens(TOKEN_SET);

    expect(result).toEqual(
      expect.objectContaining({ memberId: 'member-1', accessToken: 'access-1' }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1', accessTokenExpiresAt: expect.any(Date) }),
    );
  });

  it('should replace the token pair when the same member is reinstalled', async () => {
    const current = { id: 'id-1', memberId: 'member-1', accessToken: 'old' };
    repository.find.mockResolvedValue([current]);
    repository.save.mockImplementation((value) => value);

    await service.saveTokens({
      ...TOKEN_SET,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-1',
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    );
  });

  it('should reject a different member id without changing stored credentials', async () => {
    repository.find.mockResolvedValue([{ id: 'id-1', memberId: 'member-other' }]);

    await expect(service.saveTokens(TOKEN_SET)).rejects.toThrow('Bitrix24 installation không khớp');
    expect(repository.save).not.toHaveBeenCalled();
  });
});
