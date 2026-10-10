import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LeadSyncController } from '../controllers/lead-sync.controller.js';
import { LeadSyncBusyError, LeadSyncConfigError, LeadSyncMappingError } from '../errors/index.js';

function controller(overrides: { start?: jest.Mock; load?: jest.Mock; save?: jest.Mock } = {}) {
  const runner = {
    start: overrides.start ?? jest.fn().mockResolvedValue({ run: { id: 'run-1' } }),
  };
  const status = { listRuns: jest.fn(), getRun: jest.fn(), getStatus: jest.fn() };
  const mappingLoader = {
    load: overrides.load ?? jest.fn().mockResolvedValue({ mapping: { fields: [] } }),
    save: overrides.save ?? jest.fn().mockResolvedValue({ mapping: { fields: ['name'] } }),
  };
  return {
    target: new LeadSyncController(
      runner as never,
      status as never,
      mappingLoader as never,
      { mappingPath: 'mapping.json' } as never,
    ),
    runner,
    status,
    mappingLoader,
  };
}

describe('LeadSyncController', () => {
  it('starts a run and maps busy/configuration failures to HTTP errors', async () => {
    const setup = controller();
    await expect(setup.target.trigger({ dryRun: true, force: false })).resolves.toEqual({
      runId: 'run-1',
    });
    expect(setup.runner.start).toHaveBeenCalledWith({
      trigger: 'http',
      dryRun: true,
      force: false,
    });
    await expect(
      controller({
        start: jest.fn().mockRejectedValue(new LeadSyncBusyError('active')),
      }).target.trigger(),
    ).rejects.toThrow(ConflictException);
    await expect(
      controller({
        start: jest.fn().mockRejectedValue(new LeadSyncConfigError('missing config')),
      }).target.trigger(),
    ).rejects.toThrow(ServiceUnavailableException);
    const unknown = new Error('other');
    await expect(
      controller({ start: jest.fn().mockRejectedValue(unknown) }).target.trigger(),
    ).rejects.toBe(unknown);
  });

  it('starts a default run when the trigger body is omitted', async () => {
    const setup = controller();

    await expect(setup.target.trigger()).resolves.toEqual({ runId: 'run-1' });
    expect(setup.runner.start).toHaveBeenCalledWith({
      trigger: 'http',
      dryRun: undefined,
      force: undefined,
    });
  });

  it('delegates run/status reads and returns the active mapping path', async () => {
    const setup = controller();
    await setup.target.listRuns({ page: 2, limit: 5 });
    await setup.target.getRun('id');
    await setup.target.getStatus();
    expect(setup.status.listRuns).toHaveBeenCalledWith(2, 5);
    expect(setup.status.getRun).toHaveBeenCalledWith('id');
    expect(setup.status.getStatus).toHaveBeenCalled();
    await expect(setup.target.getMapping()).resolves.toEqual({
      path: 'mapping.json',
      mapping: { fields: [] },
    });
    await expect(setup.target.saveMapping({ fields: [] })).resolves.toEqual({
      path: 'mapping.json',
      mapping: { fields: ['name'] },
    });
    expect(setup.mappingLoader.save).toHaveBeenCalledWith({ fields: [] });
  });

  it('maps invalid mappings to 400, config failures to 503, and preserves unknown errors', async () => {
    await expect(
      controller({
        load: jest.fn().mockRejectedValue(new LeadSyncMappingError(['name'])),
      }).target.getMapping(),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller({
        load: jest.fn().mockRejectedValue(new LeadSyncConfigError('unreadable')),
      }).target.getMapping(),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      controller({
        save: jest.fn().mockRejectedValue(new LeadSyncMappingError(['name'])),
      }).target.saveMapping({}),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller({
        save: jest.fn().mockRejectedValue(new LeadSyncConfigError('unreadable')),
      }).target.saveMapping({}),
    ).rejects.toThrow(ServiceUnavailableException);
    const unknown = new Error('unknown');
    await expect(
      controller({ save: jest.fn().mockRejectedValue(unknown) }).target.saveMapping({}),
    ).rejects.toBe(unknown);
  });
});
