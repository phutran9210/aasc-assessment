import { DataSource } from 'typeorm';

import { BitrixInstallation } from '../entities/bitrix-installation.entity.js';
import { BitrixInstallationRepository } from '../repositories/bitrix-installation.repository.js';
import type { BitrixTokenSet } from '../types/index.js';
import type { RefreshLease } from '../types/bitrix-installation-snapshot.type.js';

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

function requireLease(lease: RefreshLease | null): RefreshLease {
  if (!lease) throw new Error('Expected a refresh lease');
  return lease;
}

/** Runs against a real in-memory SQLite database: the guarantees here are SQL-level. */
describe('BitrixInstallationRepository locking', () => {
  let dataSource: DataSource;
  let repository: BitrixInstallationRepository;
  let id: string;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [BitrixInstallation],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = new BitrixInstallationRepository(dataSource);
    id = (await repository.saveTokens(TOKEN_SET)).id;
  });

  afterEach(async () => dataSource.destroy());

  it('should grant the refresh lock to one caller only', async () => {
    const lease = await repository.acquireRefreshLock(id, 'refresh-1', 30_000);
    expect(lease).toMatchObject({ installationId: id, ownerToken: expect.any(String) });
    await expect(repository.acquireRefreshLock(id, 'refresh-1', 30_000)).resolves.toBeNull();
  });

  it('should grant the lock again after it is released or its lease expires', async () => {
    const firstLease = await repository.acquireRefreshLock(id, 'refresh-1', 30_000);
    await repository.releaseRefreshLock(requireLease(firstLease));
    await expect(repository.acquireRefreshLock(id, 'refresh-1', 30_000)).resolves.toMatchObject({
      installationId: id,
    });
  });

  it('should refuse the lock when the refresh token was already replaced', async () => {
    await expect(repository.acquireRefreshLock(id, 'stale-refresh', 30_000)).resolves.toBeNull();
  });

  it('should replace tokens and free the lock when the refresh token is unchanged', async () => {
    const lease = await repository.acquireRefreshLock(id, 'refresh-1', 30_000);

    await expect(
      repository.replaceTokens(requireLease(lease), 'refresh-1', {
        ...TOKEN_SET,
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      }),
    ).resolves.toBe(true);

    const stored = await repository.findCurrent();
    expect(stored).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    await expect(repository.acquireRefreshLock(id, 'refresh-2', 30_000)).resolves.toMatchObject({
      installationId: id,
    });
  });

  it('should not overwrite tokens that were replaced by a reinstall meanwhile', async () => {
    const lease = await repository.acquireRefreshLock(id, 'refresh-1', 30_000);
    await repository.saveTokens({
      ...TOKEN_SET,
      accessToken: 'reinstall-access',
      refreshToken: 'reinstall-refresh',
    });

    await expect(
      repository.replaceTokens(requireLease(lease), 'refresh-1', {
        ...TOKEN_SET,
        accessToken: 'late-access',
        refreshToken: 'late-refresh',
      }),
    ).resolves.toBe(false);

    const stored = await repository.findCurrent();
    expect(stored).toMatchObject({
      accessToken: 'reinstall-access',
      refreshToken: 'reinstall-refresh',
    });
  });

  it('should not let an expired lease release the replacement lease', async () => {
    const initialTime = Date.now();
    jest.useFakeTimers({ now: initialTime });
    try {
      const leaseA = await repository.acquireRefreshLock(id, 'refresh-1', 10);
      expect(leaseA).not.toBeNull();
      jest.advanceTimersByTime(11);
      const leaseB = await repository.acquireRefreshLock(id, 'refresh-1', 30_000);
      expect(leaseB).not.toBeNull();

      await repository.releaseRefreshLock(requireLease(leaseA));

      await expect(repository.acquireRefreshLock(id, 'refresh-1', 30_000)).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
