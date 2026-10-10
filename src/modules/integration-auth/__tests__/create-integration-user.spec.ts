import bcrypt from 'bcrypt';

import {
  createIntegrationUser,
  runCreateIntegrationUserCli,
} from '../cli/create-integration-user.js';

const valid = {
  username: 'operator.test',
  roles: ['integration_operator'],
  password: 'StrongSecret!2026',
};

function setup(existing = false) {
  const users = {
    findOne: jest.fn().mockResolvedValue(existing ? { id: 'existing-user' } : null),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { insert: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    getRepository: jest.fn().mockReturnValueOnce(users).mockReturnValueOnce(audit),
  };
  const dataSource = {
    transaction: jest.fn((callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
  };
  return { dataSource, users, audit };
}

describe('createIntegrationUser', () => {
  it.each(['ab', ' space', 'name with space', 'a'.repeat(81)])(
    'rejects invalid username %j',
    async (username) => {
      const { dataSource } = setup();
      await expect(
        createIntegrationUser(dataSource as never, { ...valid, username }),
      ).rejects.toThrow('Username must be 3-80 characters');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([{ roles: [] }, { roles: ['integration_operator', 'unknown'] }])(
    'rejects unauthorized roles %j',
    async ({ roles }) => {
      const { dataSource } = setup();
      await expect(createIntegrationUser(dataSource as never, { ...valid, roles })).rejects.toThrow(
        'Roles must be chosen from',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['short', 'a'.repeat(73)])(
    'rejects a password outside the byte limit',
    async (password) => {
      const { dataSource } = setup();
      await expect(
        createIntegrationUser(dataSource as never, { ...valid, password }),
      ).rejects.toThrow('Password must be 12 to 72 bytes long');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['password1234', 'operator.test-strong-password'])(
    'rejects placeholder or username-derived secrets',
    async (password) => {
      const { dataSource } = setup();
      await expect(
        createIntegrationUser(dataSource as never, { ...valid, password }),
      ).rejects.toThrow('Password is a known placeholder or contains the username');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate username without writing user or audit rows', async () => {
    const { dataSource, users, audit } = setup(true);

    await expect(createIntegrationUser(dataSource as never, valid)).rejects.toThrow(
      'A user with this username already exists',
    );
    expect(users.insert).not.toHaveBeenCalled();
    expect(audit.insert).not.toHaveBeenCalled();
  });

  it('hashes the password and creates user and audit records in one transaction', async () => {
    const { dataSource, users, audit } = setup();

    const created = await createIntegrationUser(dataSource as never, {
      ...valid,
      roles: ['integration_operator', 'integration_operator'],
    });

    expect(created).toMatchObject({ username: 'operator.test', roles: ['integration_operator'] });
    const stored = users.insert.mock.calls[0]?.[0] as { id: string; passwordHash: string };
    expect(stored.id).toBe(created.id);
    expect(await bcrypt.compare(valid.password, stored.passwordHash)).toBe(true);
    expect(audit.insert.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'user.created',
      aggregateId: created.id,
      metadata: { username: 'operator.test', roles: ['integration_operator'], source: 'cli' },
    });
  });
});

describe('runCreateIntegrationUserCli', () => {
  const makeDependencies = (overrides: Record<string, unknown> = {}) => {
    const users = { findOne: jest.fn().mockResolvedValue(null), insert: jest.fn() };
    const audit = { insert: jest.fn() };
    const manager = {
      getRepository: jest.fn().mockReturnValueOnce(users).mockReturnValueOnce(audit),
    };
    const dataSource = {
      isInitialized: true,
      initialize: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn((callback: (tx: typeof manager) => Promise<unknown>) =>
        callback(manager),
      ),
    };
    const dependencies = {
      args: ['operator.test', 'integration_operator'],
      isTTY: false,
      readPassword: jest.fn().mockResolvedValue(valid.password),
      createDataSource: jest.fn(() => dataSource),
      writeOutput: jest.fn(),
      ...overrides,
    };
    return { dependencies, dataSource };
  };

  it('shows usage before reading a secret or creating a database connection', async () => {
    const { dependencies } = makeDependencies({ args: ['operator.test'] });

    await expect(runCreateIntegrationUserCli(dependencies as never)).rejects.toThrow('Usage:');
    expect(dependencies.readPassword).not.toHaveBeenCalled();
    expect(dependencies.createDataSource).not.toHaveBeenCalled();
  });

  it('requires a matching repeated secret in an interactive terminal', async () => {
    const { dependencies } = makeDependencies({
      isTTY: true,
      readPassword: jest.fn().mockResolvedValueOnce('first-secret').mockResolvedValueOnce('other'),
    });

    await expect(runCreateIntegrationUserCli(dependencies as never)).rejects.toThrow(
      'Passwords do not match',
    );
    expect(dependencies.readPassword).toHaveBeenCalledTimes(2);
    expect(dependencies.createDataSource).not.toHaveBeenCalled();
  });

  it('creates an account from piped input and closes an initialized database', async () => {
    const { dependencies, dataSource } = makeDependencies();

    await runCreateIntegrationUserCli(dependencies as never);

    expect(dependencies.readPassword).toHaveBeenCalledTimes(1);
    expect(dataSource.initialize).toHaveBeenCalledTimes(1);
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      'Created operator.test with roles integration_operator',
    );
  });

  it('leaves an uninitialized database alone during cleanup', async () => {
    const { dependencies, dataSource } = makeDependencies();
    dataSource.isInitialized = false;

    await runCreateIntegrationUserCli(dependencies as never);

    expect(dataSource.destroy).not.toHaveBeenCalled();
  });
});
