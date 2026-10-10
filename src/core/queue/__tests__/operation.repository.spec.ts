import { ConflictException } from '@nestjs/common';

import { OperationEntity } from '../entities/operation.entity.js';
import { OperationRepository } from '../repositories/operation.repository.js';

describe('OperationRepository', () => {
  const repository = new OperationRepository();
  const operation = {
    id: 'operation-1',
    operationKey: 'sync/lead-1',
    kind: 'lead.sync',
    aggregateId: 'lead-1',
    targetVersion: 4,
    payload: { leadId: 'lead-1' },
    configRevisions: { mapping: 2 },
    actorId: 'actor-1',
  };

  function setup() {
    const query = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    const repo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(() => query),
    };
    const insertQuery = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    const tx = {
      getRepository: jest.fn(() => repo),
      createQueryBuilder: jest.fn(() => insertQuery),
    };
    return { tx, repo, query, insertQuery };
  }

  it('delegates standard lookups, writes, and active-operation queries', async () => {
    const { tx, repo, query } = setup();
    repo.findOne.mockResolvedValue(operation);
    repo.save.mockResolvedValue(operation);
    repo.create.mockReturnValue(operation);
    query.getOne.mockResolvedValue(operation);

    await expect(repository.findById('operation-1', tx as never)).resolves.toBe(operation);
    await expect(repository.findByKey('sync/lead-1', tx as never)).resolves.toBe(operation);
    await expect(repository.findByIdForUpdate('operation-1', tx as never)).resolves.toBe(operation);
    await expect(repository.findByKeyForUpdate('sync/lead-1', tx as never)).resolves.toBe(
      operation,
    );
    await expect(repository.save(operation as never, tx as never)).resolves.toBe(operation);
    expect(repository.create({ id: 'new' }, tx as never)).toBe(operation);
    await expect(
      repository.hasActiveAggregateOperation('lead-1', 'other', ['pending'], tx as never),
    ).resolves.toBe(true);
    query.getOne.mockResolvedValue(null);
    await expect(
      repository.hasActiveAggregateOperation('lead-1', 'other', ['pending'], tx as never),
    ).resolves.toBe(false);
    expect(tx.getRepository).toHaveBeenCalledWith(OperationEntity);
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('inserts a normalized operation and reads it by the returned ID', async () => {
    const { tx, repo, insertQuery } = setup();
    insertQuery.execute.mockResolvedValue({ raw: [{ id: 'created-id' }] });
    repo.findOne.mockResolvedValue({
      ...operation,
      id: 'created-id',
      aggregateId: null,
      targetVersion: null,
      payload: {},
      configRevisions: {},
      actorId: null,
    });

    const result = await repository.ensure(
      { operationKey: 'sync/lead-1', kind: 'lead.sync' } as never,
      tx as never,
    );

    expect(result.id).toBe('created-id');
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKey: 'sync/lead-1',
        aggregateId: null,
        targetVersion: null,
        payload: {},
        configRevisions: {},
        actorId: null,
        status: 'pending',
      }),
    );
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'created-id' } });
  });

  it('loads an ignored insert by operation key and rejects missing or mismatched records', async () => {
    const { tx, repo, insertQuery } = setup();
    insertQuery.execute.mockResolvedValue({ raw: [] });
    repo.findOne.mockResolvedValue(operation);
    await expect(
      repository.ensure(
        {
          operationKey: operation.operationKey,
          kind: operation.kind,
          aggregateId: operation.aggregateId,
          targetVersion: operation.targetVersion,
          payload: operation.payload,
          configRevisions: operation.configRevisions,
          actorId: operation.actorId,
        } as never,
        tx as never,
      ),
    ).resolves.toBe(operation);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { operationKey: operation.operationKey } });

    repo.findOne.mockResolvedValueOnce(null);
    await expect(
      repository.ensure({ operationKey: 'missing', kind: 'lead.sync' } as never, tx as never),
    ).rejects.toThrow('Operation insert did not return a stored operation');

    repo.findOne.mockResolvedValueOnce({ ...operation, payload: { leadId: 'different' } });
    await expect(
      repository.ensure(
        {
          operationKey: operation.operationKey,
          kind: operation.kind,
          aggregateId: operation.aggregateId,
          targetVersion: operation.targetVersion,
          payload: operation.payload,
          configRevisions: operation.configRevisions,
          actorId: operation.actorId,
        } as never,
        tx as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
