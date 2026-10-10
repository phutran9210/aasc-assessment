import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuditEventEntity } from '../entities/audit-event.entity.js';
import { ConfigurationEntity } from '../entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '../entities/configuration-head.entity.js';
import { ConfigurationRepository } from '../repositories/configuration.repository.js';

describe('ConfigurationRepository', () => {
  function setup() {
    const heads = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    const configs = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
    const audits = { save: jest.fn() };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === ConfigurationHeadEntity) return heads;
        if (entity === ConfigurationEntity) return configs;
        if (entity === AuditEventEntity) return audits;
        throw new Error('unexpected entity');
      }),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((run: (tx: typeof manager) => Promise<unknown>) => run(manager)),
    };
    return {
      repository: new ConfigurationRepository(dataSource as never),
      dataSource,
      manager,
      heads,
      configs,
      audits,
    };
  }

  it('reads active configuration and unwraps valid config and compiled mapping', async () => {
    const { repository, heads, configs, manager } = setup();
    const entity = {
      key: 'mapping',
      revision: 4,
      value: { config: { fields: [] }, compiled: { version: 1 } },
    };
    heads.findOne.mockResolvedValue({ key: 'mapping', revision: 4 });
    configs.findOne.mockResolvedValue(entity);
    await expect(repository.findActive('mapping', manager as never)).resolves.toEqual({
      entity,
      value: { fields: [] },
      compiled: { version: 1 },
    });
  });

  it('reports missing heads and broken head revisions and unwraps malformed wrappers safely', async () => {
    const { repository, heads, configs, manager } = setup();
    heads.findOne.mockResolvedValueOnce(null);
    await expect(repository.findActive('missing', manager as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    heads.findOne.mockResolvedValueOnce({ key: 'mapping', revision: 2 });
    configs.findOne.mockResolvedValueOnce(null);
    await expect(repository.findActive('mapping', manager as never)).rejects.toThrow(
      'head mapping:2 is invalid',
    );
    heads.findOne.mockResolvedValueOnce({ key: 'mapping', revision: 3 });
    configs.findOne.mockResolvedValueOnce({
      key: 'mapping',
      revision: 3,
      value: { config: [], compiled: [] },
    });
    await expect(repository.findActive('mapping', manager as never)).resolves.toMatchObject({
      value: { config: [], compiled: [] },
      compiled: null,
    });
    heads.findOne.mockResolvedValueOnce({ key: 'mapping', revision: 3 });
    configs.findOne.mockResolvedValueOnce({
      key: 'mapping',
      revision: 3,
      value: { config: { ok: true }, compiled: [] },
    });
    await expect(repository.findActive('mapping', manager as never)).resolves.toMatchObject({
      value: { ok: true },
      compiled: null,
    });
  });

  it('compare-and-sets a new revision under a transaction lock and writes its audit event', async () => {
    const { repository, manager, heads, configs, audits } = setup();
    heads.findOne.mockResolvedValue({ key: 'rules', revision: 2 });
    configs.save.mockImplementation((entity) => entity);
    const result = await repository.compareAndSet({
      key: 'rules',
      expectedRevision: 2,
      value: { enabled: true },
      compiled: null,
      actorId: 'user-1',
    });
    expect(result).toMatchObject({
      value: { enabled: true },
      entity: { revision: 3, createdBy: 'user-1' },
    });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['rules'],
    );
    expect(heads.save).toHaveBeenCalledWith({ key: 'rules', revision: 3 });
    expect(audits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'configuration.rules.updated',
        metadata: { key: 'rules', revision: 3 },
      }),
    );
  });

  it('starts at revision one when a head does not exist and rejects stale writes', async () => {
    const { repository, heads, configs } = setup();
    heads.findOne.mockResolvedValueOnce(null);
    configs.save.mockImplementation((entity) => entity);
    await expect(
      repository.compareAndSet({
        key: 'new',
        expectedRevision: 0,
        value: {},
        compiled: { x: 1 } as never,
        actorId: 'user',
      }),
    ).resolves.toMatchObject({ entity: { revision: 1 } });
    heads.findOne.mockResolvedValueOnce({ key: 'new', revision: 1 });
    await expect(
      repository.compareAndSet({
        key: 'new',
        expectedRevision: 0,
        value: {},
        compiled: null,
        actorId: 'user',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists revisions and finds a specific stored revision', async () => {
    const { repository, heads, configs, manager } = setup();
    heads.find.mockResolvedValue([
      { key: 'a', revision: 1 },
      { key: 'b', revision: 7 },
    ]);
    configs.findOne.mockResolvedValue({ key: 'a', revision: 1 });
    await expect(repository.revisions(manager as never)).resolves.toEqual({ a: 1, b: 7 });
    await expect(repository.findRevision('a', 1, manager as never)).resolves.toEqual({
      key: 'a',
      revision: 1,
    });
  });
});
