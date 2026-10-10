import { createHash } from 'node:crypto';

import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { ConversionService } from '../services/conversion.service.js';

function createService(lead: Record<string, unknown>, submission?: Record<string, unknown>) {
  const manager = {};
  const dataSource = {
    manager,
    transaction: jest.fn((run: (tx: object) => Promise<unknown>) => run(manager)),
  };
  const gateway = {
    metadata: jest.fn().mockResolvedValue({
      stages: [{ categoryId: 1, id: 'C1:NEW', semantic: 'open' }],
      users: [{ id: 'sales-1', active: true }],
    }),
  };
  const configurations = {
    findActive: jest.fn().mockResolvedValue({
      entity: { revision: 3 },
      value: {
        manual_conversion: {
          enabled: false,
          pipeline_id: 1,
          stage_id: 'C1:NEW',
          fallback_sales_id: 'sales-1',
        },
        assignment: { fallback_sales_id: 'sales-1' },
      },
    }),
  };
  const assignments = { reserve: jest.fn().mockResolvedValue('sales-1') };
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    findByIdForUpdate: jest.fn().mockResolvedValue(lead),
  };
  const deals = {
    findByLeadForUpdate: jest.fn().mockResolvedValue(null),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const operations = {
    findByKeyForUpdate: jest.fn().mockResolvedValue(null),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-1', status: 'pending' }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new ConversionService(
    dataSource as never,
    configurations as never,
    assignments as never,
    operations as never,
    outbox as never,
    gateway as never,
    {} as never,
    {} as never,
    leads as never,
    { findLatestForLead: jest.fn().mockResolvedValue(submission ?? null) } as never,
    deals as never,
    {} as never,
  );
  return { configurations, gateway, service, leads, deals, operations, assignments, outbox };
}

function enableManual(configurations: ReturnType<typeof createService>['configurations']) {
  configurations.findActive.mockResolvedValue({
    entity: { revision: 3 },
    value: {
      manual_conversion: {
        enabled: true,
        pipeline_id: 1,
        stage_id: 'C1:NEW',
        fallback_sales_id: 'sales-1',
      },
      assignment: { fallback_sales_id: 'sales-1' },
    },
  });
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

  it('rejects a missing lead before reading conversion policy', async () => {
    const { service, configurations } = createService(null as never);

    await expect(service.request('missing', 'manual')).rejects.toBeInstanceOf(NotFoundException);
    expect(configurations.findActive).not.toHaveBeenCalled();
  });

  it('rejects an unresolved CRM field conflict', async () => {
    const { service, configurations } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: { crmConflicts: ['phone'] },
    });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    expect(configurations.findActive).not.toHaveBeenCalled();
  });

  it('reports a temporarily unavailable conversion policy', async () => {
    const { service, configurations } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });
    configurations.findActive.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects a manual conversion when the configured CRM stage was removed', async () => {
    const { service, configurations, gateway } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });
    enableManual(configurations);
    gateway.metadata.mockResolvedValueOnce({ stages: [], users: [] });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an existing conversion that requires reconciliation', async () => {
    const lead = { id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} };
    const { service, configurations, deals, assignments } = createService(lead);
    enableManual(configurations);
    deals.findByLeadForUpdate.mockResolvedValueOnce({
      id: 'deal-1',
      conversionStatus: 'reconcile_required',
    });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    expect(assignments.reserve).not.toHaveBeenCalled();
  });

  it('returns the existing completed conversion without reserving another assignee', async () => {
    const lead = { id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} };
    const { service, configurations, deals, assignments } = createService(lead);
    enableManual(configurations);
    deals.findByLeadForUpdate.mockResolvedValueOnce({
      id: 'deal-1',
      conversionStatus: 'completed',
      bitrixDealId: 'crm-deal-1',
    });

    await expect(service.request('lead-1', 'manual')).resolves.toEqual({
      status: 'completed',
      dealId: 'deal-1',
      bitrixDealId: 'crm-deal-1',
    });
    expect(assignments.reserve).not.toHaveBeenCalled();
  });

  it('rejects an assignee that is no longer active in CRM metadata', async () => {
    const lead = { id: 'lead-1', syncStatus: 'synced', fieldProvenance: {} };
    const { service, configurations, gateway, assignments } = createService(lead);
    enableManual(configurations);
    gateway.metadata.mockResolvedValueOnce({
      stages: [{ categoryId: 1, id: 'C1:NEW', semantic: 'open' }],
      users: [{ id: 'sales-1', active: false }],
    });

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    expect(assignments.reserve).toHaveBeenCalledTimes(1);
  });

  it('creates one pending conversion and queues its operation', async () => {
    const lead = {
      id: 'lead-1',
      name: 'Nguyen An',
      portalKey: 'portal-1',
      version: 4,
      syncStatus: 'synced',
      fieldProvenance: {},
    };
    const { service, configurations, deals, operations, outbox } = createService(lead);
    enableManual(configurations);

    await expect(
      service.request('lead-1', 'manual', 'actor-1', 'key-1', { source: 'api' }),
    ).resolves.toMatchObject({ status: 'pending', operationId: 'operation-1' });
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        title: 'TikTok - Nguyen An - Lead',
        assignedTo: 'sales-1',
        ruleRevision: 3,
      }),
      expect.anything(),
    );
    expect(operations.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ operationKey: 'convert/lead-1', targetVersion: 4 }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('returns an existing pending conversion without creating a second deal', async () => {
    const { service, configurations, deals, operations, assignments } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });
    enableManual(configurations);
    deals.findByLeadForUpdate.mockResolvedValueOnce({
      id: 'deal-1',
      conversionStatus: 'pending',
      bitrixDealId: null,
    });
    operations.findByKeyForUpdate.mockResolvedValueOnce({ id: 'operation-1', payload: {} });

    await expect(service.request('lead-1', 'manual')).resolves.toEqual({
      status: 'pending',
      operationId: 'operation-1',
      dealId: 'deal-1',
    });
    expect(assignments.reserve).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key when its request body changed', async () => {
    const { service, configurations, deals, operations } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });
    enableManual(configurations);
    deals.findByLeadForUpdate.mockResolvedValueOnce({
      id: 'deal-1',
      conversionStatus: 'pending',
      bitrixDealId: null,
    });
    operations.findByKeyForUpdate.mockResolvedValueOnce({
      id: 'operation-1',
      payload: {
        idempotencyKeys: {
          [createHash('sha256').update('lead-1\0actor-1\0key-1').digest('hex')]: {
            bodyHash: 'different-body',
          },
        },
      },
    });

    await expect(
      service.request('lead-1', 'manual', 'actor-1', 'key-1', { source: 'api' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports CRM metadata outages as temporarily unavailable', async () => {
    const { service, configurations, gateway } = createService({
      id: 'lead-1',
      syncStatus: 'synced',
      fieldProvenance: {},
    });
    enableManual(configurations);
    gateway.metadata.mockRejectedValueOnce(new Error('CRM unavailable'));

    await expect(service.request('lead-1', 'manual')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
