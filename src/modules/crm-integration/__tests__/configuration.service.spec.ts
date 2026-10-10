import { NotFoundException } from '@nestjs/common';

import { ConfigurationService } from '../services/configuration.service.js';

function setup() {
  const repository = {
    findActive: jest.fn().mockResolvedValue({
      entity: { revision: 3 },
      value: { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      compiled: { entries: [] },
    }),
    compareAndSet: jest.fn().mockResolvedValue({
      entity: { revision: 4 },
      value: { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      compiled: { entries: [] },
    }),
    revisions: jest.fn().mockResolvedValue({ mapping: 4, rules: 2 }),
  };
  const crm = {
    metadata: jest.fn().mockResolvedValue({
      lead: {
        fields: {
          name: { name: 'name', readOnly: false },
          title: { name: 'title', maxLength: 180, readOnly: false },
        },
      },
      stages: [],
      users: [],
    }),
  };
  return { service: new ConfigurationService(repository as never, crm as never), repository, crm };
}

describe('ConfigurationService If-Match handling', () => {
  it('rejects a missing If-Match without reading provider metadata or writing', async () => {
    const repository = { compareAndSet: jest.fn(), findActive: jest.fn() };
    const crm = { metadata: jest.fn() };
    const service = new ConfigurationService(repository as never, crm as never);

    await expect(
      service.replaceFromIfMatch('mapping', { fields: [] }, undefined, 'actor-1'),
    ).rejects.toMatchObject({ status: 428 });

    expect(crm.metadata).not.toHaveBeenCalled();
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('rejects malformed If-Match before reading provider metadata or writing', async () => {
    const repository = { compareAndSet: jest.fn(), findActive: jest.fn() };
    const crm = { metadata: jest.fn() };
    const service = new ConfigurationService(repository as never, crm as never);

    await expect(
      service.replaceFromIfMatch('mapping', { fields: [] }, 'revision-3', 'actor-1'),
    ).rejects.toMatchObject({ status: 400 });

    expect(crm.metadata).not.toHaveBeenCalled();
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it.each(['"-1"', '"01"', '3', '"9007199254740992"'])(
    'rejects invalid If-Match %s',
    async (etag) => {
      const { service, repository } = setup();

      await expect(
        service.replaceFromIfMatch('mapping', {}, etag, 'actor-1'),
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('accepts a quoted revision and passes it to the compare-and-set write', async () => {
    const { service, repository } = setup();

    const result = await service.replaceFromIfMatch(
      'mapping',
      { entries: [{ source: 'name', target: 'name', owner: 'integration' }] },
      ' "3" ',
      'actor-1',
    );

    expect(result).toMatchObject({ key: 'mapping', revision: 4, etag: '"4"' });
    expect(repository.compareAndSet.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 3,
      actorId: 'actor-1',
      compiled: { entries: [{ sourcePath: ['name'], target: 'name' }], titleMaxLength: 180 },
    });
  });

  it('reads the built-in mapping at revision zero when none has been stored', async () => {
    const { service, repository } = setup();
    repository.findActive.mockRejectedValueOnce(new Error('not found'));
    await expect(service.read('mapping')).rejects.toThrow('not found');
    repository.findActive.mockRejectedValueOnce(new NotFoundException());

    await expect(service.read('mapping')).resolves.toMatchObject({
      key: 'mapping',
      revision: 0,
      etag: '"0"',
      compiled: { entries: expect.any(Array) },
    });
  });

  it('rejects unsupported keys and negative revisions before reading provider metadata', async () => {
    const { service, crm } = setup();

    await expect(service.read('unknown')).rejects.toThrow('Configuration key is invalid');
    await expect(service.replace('mapping', {}, -1, 'actor-1')).rejects.toThrow(
      'Expected configuration revision is invalid',
    );
    await expect(service.replace('scoring', {}, 0, 'actor-1')).rejects.toThrow(
      'Configuration key is not supported yet',
    );
    expect(crm.metadata).not.toHaveBeenCalled();
  });

  it('rejects an invalid mapping document before making a provider call', async () => {
    const { service, crm } = setup();

    await expect(service.replace('mapping', { entries: [] }, 3, 'actor-1')).rejects.toThrow(
      'Invalid mapping configuration',
    );
    expect(crm.metadata).not.toHaveBeenCalled();
  });

  it('returns zero for missing revisions in a configuration snapshot', async () => {
    const { service, repository } = setup();
    repository.revisions.mockResolvedValueOnce({ mapping: 4 });

    await expect(service.snapshot({} as never)).resolves.toEqual({
      mapping: 4,
      rules: 0,
      scoring: 0,
    });
  });
});
