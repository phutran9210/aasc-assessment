import { ConfigurationService } from '../services/configuration.service.js';

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
});
