import { ConfigurationController } from '../controllers/configuration.controller.js';

describe('ConfigurationController', () => {
  it('sets the ETag and returns the configuration receipt', async () => {
    const receipt = { key: 'mapping', revision: 3, etag: '"3"', value: { fields: [] } };
    const service = {
      read: jest.fn(),
      replaceFromIfMatch: jest.fn().mockResolvedValue(receipt),
    };
    const controller = new ConfigurationController(service as never);
    const response = { setHeader: jest.fn() };

    await expect(
      controller.replace(
        'mapping',
        '"2"',
        { value: { fields: [] } },
        { user: { sub: 'actor-1' } } as never,
        response as never,
      ),
    ).resolves.toBe(receipt);

    expect(service.replaceFromIfMatch).toHaveBeenCalledWith(
      'mapping',
      { fields: [] },
      '"2"',
      'actor-1',
    );
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"3"');
  });
});
