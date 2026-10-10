import { OperationRunnerService } from '../services/operation-runner.service.js';

function setup() {
  const operation = {
    id: 'operation-1',
    operationKey: 'sync/lead-1/1',
    kind: 'bitrix_lead_sync',
    status: 'pending',
    attempt: 0,
    nextAttemptAt: null as Date | null,
    leaseToken: null as string | null,
    leaseUntil: null as Date | null,
    remoteId: null as string | null,
    lastErrorCode: null as string | null,
    lastErrorDetail: null,
    configRevisions: {},
    payload: {},
    completedAt: null as Date | null,
  };
  const query = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getExists: jest.fn().mockResolvedValue(true),
  };
  const repository = {
    findOne: jest.fn().mockImplementation(() => Promise.resolve(operation)),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    createQueryBuilder: jest.fn().mockReturnValue(query),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(repository) };
  const dataSource = {
    transaction: jest.fn((callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
    getRepository: jest.fn().mockReturnValue(repository),
  };
  const handler = {
    handle: jest.fn().mockResolvedValue({ outcome: 'succeeded', remoteId: 'remote-1' }),
  };
  const handlers = { get: jest.fn().mockReturnValue(handler) };
  const leases = {
    claim: jest.fn().mockResolvedValue({ key: 'lead/lead-1', ownerToken: 'lease-1' }),
    isOwner: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(true),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new OperationRunnerService(
    dataSource as never,
    handlers as never,
    leases as never,
    outbox as never,
  );
  return { service, operation, repository, query, handler, handlers, leases, outbox };
}

describe('OperationRunnerService', () => {
  it('does not claim an operation that no longer exists', async () => {
    const { service, repository, handler } = setup();
    repository.findOne.mockResolvedValueOnce(null);

    await expect(service.run('missing')).resolves.toBeNull();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('does not run an operation before its next attempt time', async () => {
    const { service, operation, handler } = setup();
    operation.nextAttemptAt = new Date(Date.now() + 60_000);

    await expect(service.run('operation-1')).resolves.toBeNull();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('quarantines an operation without an enabled handler', async () => {
    const { service, handlers, operation } = setup();
    handlers.get.mockReturnValueOnce(undefined);

    await expect(service.run('operation-1')).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'HANDLER_NOT_ENABLED',
    });
    expect(operation.status).toBe('quarantined');
    expect(operation.leaseToken).toBeNull();
  });

  it('finishes a successful operation with its remote ID and completion time', async () => {
    const { service, operation, repository, handler } = setup();

    await expect(service.run('operation-1')).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: 'remote-1',
    });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(operation).toMatchObject({
      status: 'succeeded',
      remoteId: 'remote-1',
      completedAt: expect.any(Date),
    });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('reschedules a deferred retry without consuming an attempt', async () => {
    const { service, operation, handler, outbox } = setup();
    const retryAt = new Date(Date.now() + 5_000);
    handler.handle.mockResolvedValueOnce({
      outcome: 'retry_wait',
      nextAttemptAt: retryAt,
      errorCode: 'LEASE_BUSY',
      deferred: true,
    });

    await expect(service.run('operation-1')).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'LEASE_BUSY',
    });
    expect(operation).toMatchObject({ status: 'retry_wait', attempt: 0, nextAttemptAt: retryAt });
    expect(outbox.append).toHaveBeenCalledWith(
      'operation-1',
      expect.any(String),
      retryAt,
      expect.anything(),
    );
  });

  it('aborts without finishing when the database reports lost ownership', async () => {
    const { service, query, operation, repository } = setup();
    query.getExists.mockResolvedValueOnce(false);

    await expect(service.run('operation-1')).resolves.toBeNull();
    expect(operation.status).toBe('processing');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('claims and releases an aggregate lease around the handler', async () => {
    const { service, handler, leases } = setup();
    handler.handle.mockImplementationOnce(
      async (context: { acquireAggregateLease(key: string): Promise<unknown> }) => {
        await context.acquireAggregateLease('lead/lead-1');
        return { outcome: 'succeeded' };
      },
    );

    await expect(service.run('operation-1')).resolves.toEqual({ outcome: 'succeeded' });
    expect(leases.claim).toHaveBeenCalledWith('lead/lead-1', 60_000);
    expect(leases.release).toHaveBeenCalledTimes(1);
  });
});
