import { AggregateLeaseRepository } from '../repositories/aggregate-lease.repository.js';

describe('AggregateLeaseRepository', () => {
  const lease = { key: 'lead/1', ownerToken: 'owner', expiresAt: new Date() };

  it('claims and renews leases and tolerates the PostgreSQL [rows, count] return form', async () => {
    const dataSource = { options: { type: 'postgres', schema: 'tenant"data' }, query: jest.fn() };
    const repository = new AggregateLeaseRepository(dataSource as never);
    const row = { ownerToken: 'new-owner', expiresAt: new Date('2026-01-01') };
    dataSource.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([[row], 1]);

    await expect(repository.claim(lease.key, 1000)).resolves.toEqual({ key: lease.key, ...row });
    await expect(repository.renew(lease, 2000)).resolves.toEqual({ key: lease.key, ...row });
    expect(dataSource.query.mock.calls[0]?.[0]).toContain(
      '"tenant""data"."integration_aggregate_lease"',
    );
  });

  it('returns null when a lease is held or has expired before renewal', async () => {
    const dataSource = { options: { type: 'sqlite' }, query: jest.fn().mockResolvedValue([]) };
    const repository = new AggregateLeaseRepository(dataSource as never);
    await expect(repository.claim(lease.key, 1000)).resolves.toBeNull();
    await expect(repository.renew(lease, 1000)).resolves.toBeNull();
  });

  it('releases only one owned lease and reads ownership from the database', async () => {
    const dataSource = { options: { type: 'postgres' }, query: jest.fn() };
    const repository = new AggregateLeaseRepository(dataSource as never);
    dataSource.query.mockResolvedValueOnce([[{ lease_key: lease.key }], 1]);
    await expect(repository.release(lease)).resolves.toBe(true);
    dataSource.query.mockResolvedValueOnce([]);
    await expect(repository.release(lease)).resolves.toBe(false);
    dataSource.query.mockResolvedValueOnce([{ owned: true }]);
    await expect(repository.isOwner(lease)).resolves.toBe(true);
    dataSource.query.mockResolvedValueOnce([]);
    await expect(repository.isOwner(lease)).resolves.toBe(false);
  });

  it('validates keys and TTLs before issuing SQL', async () => {
    const dataSource = { options: { type: 'postgres' }, query: jest.fn() };
    const repository = new AggregateLeaseRepository(dataSource as never);
    await expect(repository.claim('', 1)).rejects.toThrow(RangeError);
    await expect(repository.claim('x'.repeat(513), 1)).rejects.toThrow(RangeError);
    await expect(repository.claim('key', 0)).rejects.toThrow(RangeError);
    await expect(repository.claim('key', 1.5)).rejects.toThrow(RangeError);
    await expect(repository.renew({ ...lease, key: '' }, 1)).rejects.toThrow(RangeError);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
