import { BitrixInstallationEntity } from '../entities/bitrix-installation.entity.js';
import { PostgresBitrixInstallationRepository } from '../repositories/postgres-bitrix-installation.repository.js';

const tokenSet = {
  memberId: 'member-1',
  domain: 'portal.bitrix24.com',
  clientEndpoint: 'https://portal.bitrix24.com/rest/',
  serverEndpoint: 'https://oauth.bitrix.info/rest/',
  scope: 'crm',
  status: 'L',
  applicationToken: 'app-token',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
};

describe('PostgresBitrixInstallationRepository', () => {
  function setup() {
    const query = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    const repo = {
      createQueryBuilder: jest.fn(() => query),
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => value),
      update: jest.fn(),
    };
    const dataSource = { getRepository: jest.fn(() => repo) };
    return {
      repository: new PostgresBitrixInstallationRepository(dataSource as never, 'portal-key'),
      repo,
      query,
    };
  }

  it('loads only complete current installations and returns null when none is installed', async () => {
    const { repository, query } = setup();
    query.getOne.mockResolvedValueOnce(null);
    await expect(repository.findCurrent()).resolves.toBeNull();
    query.getOne.mockResolvedValueOnce({
      id: 'i1',
      ...tokenSet,
      accessTokenExpiresAt: new Date(),
      refreshLeaseToken: 'lease',
    });
    await expect(repository.findCurrent()).resolves.toMatchObject({
      id: 'i1',
      memberId: 'member-1',
      refreshToken: 'refresh',
    });
    query.getOne.mockResolvedValueOnce({
      id: 'i1',
      ...tokenSet,
      memberId: '',
      accessTokenExpiresAt: new Date(),
    });
    await expect(repository.findCurrent()).rejects.toThrow('Bitrix installation is incomplete');
    expect(query.addSelect).toHaveBeenCalledWith(
      expect.arrayContaining(['installation.accessToken', 'installation.refreshToken']),
    );
  });

  it('saves new or existing installation tokens and clears stale refresh leases', async () => {
    const { repository, repo } = setup();
    repo.findOne.mockResolvedValueOnce(null);
    const created = await repository.saveTokens(tokenSet);
    expect(created).toMatchObject({ memberId: 'member-1', accessToken: 'access' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        portalKey: 'portal-key',
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      }),
    );
    repo.findOne.mockResolvedValueOnce({ id: 'existing-id' });
    await repository.saveTokens({ ...tokenSet, accessToken: 'new-access' });
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'existing-id', accessToken: 'new-access' }),
    );
  });

  it('claims and replaces a refresh lease only when the database update affects one row', async () => {
    const { repository, query, repo } = setup();
    query.execute.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });
    const lease = await repository.acquireRefreshLock('i1', 'refresh', 5000);
    if (!lease) throw new Error('expected to acquire the refresh lease');
    expect(lease).toMatchObject({
      installationId: 'i1',
      ownerToken: expect.any(String),
      expiresAt: expect.any(Date),
    });
    await expect(repository.acquireRefreshLock('i1', 'refresh', 5000)).resolves.toBeNull();
    repo.update.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });
    await expect(
      repository.replaceTokens(lease, 'refresh', { ...tokenSet, accessToken: 'new' }),
    ).resolves.toBe(true);
    await expect(repository.replaceTokens(lease, 'refresh', tokenSet)).resolves.toBe(false);
    await repository.releaseRefreshLock(lease);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ refreshLeaseToken: lease.ownerToken }),
      { refreshLeaseToken: null, refreshLeaseUntil: null },
    );
    expect(query.update).toHaveBeenCalledWith(BitrixInstallationEntity);
  });
});
