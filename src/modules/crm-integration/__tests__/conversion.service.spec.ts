import { ConflictException } from '@nestjs/common';

import { ConversionService } from '../services/conversion.service.js';

function createService(lead: Record<string, unknown>, submission?: Record<string, unknown>) {
  const gateway = { metadata: jest.fn() };
  const configurations = {
    findActive: jest.fn().mockResolvedValue({
      entity: { revision: 3 },
      value: { manual_conversion: { enabled: false } },
    }),
  };
  const service = new ConversionService(
    {} as never,
    configurations as never,
    {} as never,
    {} as never,
    {} as never,
    gateway as never,
    {} as never,
    {} as never,
    { findById: jest.fn().mockResolvedValue(lead) } as never,
    { findLatestForLead: jest.fn().mockResolvedValue(submission ?? null) } as never,
    {} as never,
    {} as never,
  );
  return { configurations, gateway, service };
}

describe('ConversionService', () => {
  it('rejects a lead that is not synced before reserving a conversion', async () => {
    const { service } = createService({
      id: 'lead-1',
      syncStatus: 'pending',
      fieldProvenance: {},
    });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects manual conversion when the snapshotted policy is disabled', async () => {
    const { service, gateway } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    expect(gateway.metadata).not.toHaveBeenCalled();
  });

  it('skips auto-conversion for an import that disabled rule application', async () => {
    const { service, configurations } = createService(
      { id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} },
      { applyRules: false, isHistorical: true },
    );

    await expect(service.request('lead-1', 'rule')).resolves.toBeNull();
    expect(configurations.findActive).not.toHaveBeenCalled();
  });
});
