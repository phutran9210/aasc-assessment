import { assertDeploymentIdentity, DEPLOYMENT_IDENTITY_KEY } from '../deployment-identity.js';

const config = {
  advertiserId: 'advertiser',
  portalKey: 'portal',
  tiktokMode: 'mock' as const,
  bitrixMode: 'mock' as const,
};

function database(stored?: { key: string; value: Record<string, string> }) {
  const repository = {
    findOne: jest.fn(() => stored ?? null),
    insert: jest.fn((value) => {
      stored = value;
    }),
  };
  const manager = { query: jest.fn(), getRepository: jest.fn(() => repository) };
  const dataSource = { transaction: jest.fn((work) => work(manager)) };
  return { dataSource, manager, repository };
}

describe('assertDeploymentIdentity', () => {
  it('claims an absent identity under an advisory transaction lock', async () => {
    const db = database();
    await expect(assertDeploymentIdentity(db.dataSource as never, config)).resolves.toBe('claimed');
    expect(db.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [DEPLOYMENT_IDENTITY_KEY],
    );
    expect(db.repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ key: DEPLOYMENT_IDENTITY_KEY, value: config }),
    );
  });

  it('verifies a matching identity and rejects changed deployment fields', async () => {
    const stored = { key: DEPLOYMENT_IDENTITY_KEY, value: config };
    await expect(
      assertDeploymentIdentity(database(stored).dataSource as never, config),
    ).resolves.toBe('verified');
    await expect(
      assertDeploymentIdentity(database(stored).dataSource as never, {
        ...config,
        advertiserId: 'other',
      }),
    ).rejects.toThrow('advertiserId');
    await expect(
      assertDeploymentIdentity(database(stored).dataSource as never, {
        ...config,
        bitrixMode: 'real',
      }),
    ).rejects.toThrow('bitrixMode');
  });
});
