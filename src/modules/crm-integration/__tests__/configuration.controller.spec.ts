import { BadRequestException } from '@nestjs/common';

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
      controller.replaceMappings(
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

  it('reads and replaces the rules through their own routes', async () => {
    const receipt = { key: 'rules', revision: 1, etag: '"1"', value: {} };
    const service = {
      read: jest.fn().mockResolvedValue(receipt),
      replaceFromIfMatch: jest.fn().mockResolvedValue(receipt),
    };
    const controller = new ConfigurationController(service as never);
    const response = { setHeader: jest.fn() };

    await expect(controller.readRules(response as never)).resolves.toBe(receipt);
    await controller.replaceRules(
      '"0"',
      { deal_rules: [] },
      { user: { sub: 'actor-1' } } as never,
      response as never,
    );

    expect(service.read).toHaveBeenCalledWith('rules');
    expect(service.replaceFromIfMatch).toHaveBeenCalledWith(
      'rules',
      { deal_rules: [] },
      '"0"',
      'actor-1',
    );
  });

  it('refuses a body that carries no configuration at all', async () => {
    const service = { read: jest.fn(), replaceFromIfMatch: jest.fn() };
    const controller = new ConfigurationController(service as never);

    await expect(
      controller.replaceMappings(
        '"0"',
        {},
        { user: { sub: 'actor-1' } } as never,
        { setHeader: jest.fn() } as never,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.replaceFromIfMatch).not.toHaveBeenCalled();
  });
});
