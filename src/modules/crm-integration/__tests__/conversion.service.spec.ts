import { ConflictException } from '@nestjs/common';
import { ConversionService } from '../services/conversion.service.js';

describe('ConversionService', () => {
  it('rejects a lead that is not synced before reserving a conversion', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'lead-1', syncStatus: 'pending', fieldProvenance: {} }),
    };
    const dataSource = { getRepository: jest.fn().mockReturnValue(repository) };
    const service = new ConversionService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects manual conversion when the snapshotted policy is disabled', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} }),
    };
    const dataSource = { getRepository: jest.fn().mockReturnValue(repository) };
    const configurations = {
      findActive: jest.fn().mockResolvedValue({
        entity: { revision: 3 },
        value: { manual_conversion: { enabled: false } },
      }),
    };
    const gateway = { metadata: jest.fn() };
    const service = new ConversionService(
      dataSource as never,
      configurations as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
      {} as never,
    );

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    expect(gateway.metadata).not.toHaveBeenCalled();
  });

  it('skips auto-conversion for an import that disabled rule application', async () => {
    const leadRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} }),
    };
    const submissionRepository = {
      findOne: jest.fn().mockResolvedValue({ applyRules: false, isHistorical: true }),
    };
    const dataSource = {
      getRepository: jest
        .fn()
        .mockReturnValueOnce(leadRepository)
        .mockReturnValueOnce(submissionRepository),
    };
    const configurations = { findActive: jest.fn() };
    const service = new ConversionService(
      dataSource as never,
      configurations as never,
      {} as never,
      {} as never,
      {} as never,
      { metadata: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(service.request('lead-1', 'rule')).resolves.toBeNull();
    expect(configurations.findActive).not.toHaveBeenCalled();
  });
});
