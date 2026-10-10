import { ConflictException, NotFoundException } from '@nestjs/common';

import type { OperationEntity } from '@core/queue/entities/operation.entity.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import type { OperationResolveDto } from '../dto/operation-resolve.dto.js';
import { OperationControlService } from '../services/operation-control.service.js';

const actor: Actor = { sub: 'operator-1', sid: 'session-1', username: 'operator', roles: [] };
const manager = { query: jest.fn().mockResolvedValue([]) };

function operation(overrides: Partial<OperationEntity> = {}): OperationEntity {
  return {
    id: 'operation-1',
    operationKey: 'bitrix-lead/lead-1/0',
    kind: 'bitrix_lead_sync',
    aggregateId: 'lead-1',
    targetVersion: 1,
    status: 'dead_letter',
    attempt: 2,
    leaseUntil: new Date('2026-10-01T00:00:00Z'),
    leaseToken: 'old-lease',
    remoteId: null,
    lastErrorCode: 'REMOTE_TIMEOUT',
    lastErrorDetail: 'timeout',
    nextAttemptAt: new Date('2026-10-02T00:00:00Z'),
    payload: { leadId: 'lead-1' },
    configRevisions: { mapping: 1 },
    actorId: null,
    completedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  } as OperationEntity;
}

function setup(initial = operation()) {
  const operations = {
    findById: jest.fn().mockResolvedValue(initial),
    findByIdForUpdate: jest.fn().mockResolvedValue(initial),
    findByKey: jest.fn().mockResolvedValue(null),
    hasActiveAggregateOperation: jest.fn().mockResolvedValue(false),
    create: jest.fn((value: OperationEntity) => operation(value)),
    save: jest.fn((value: OperationEntity) => Promise.resolve(value)),
  };
  const lead = {
    id: 'lead-1',
    advertiserId: 'advertiser-1',
    portalKey: 'portal-1',
    bitrixLeadId: null,
    syncStatus: 'reconcile_required',
    lastErrorCode: 'REMOTE_TIMEOUT',
  };
  const deal = {
    id: 'deal-1',
    portalKey: 'portal-1',
    conversionStatus: 'reconcile_required',
    version: 1,
  };
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    findByIdForUpdate: jest.fn().mockResolvedValue(lead),
    findByPortalRemote: jest.fn().mockResolvedValue(null),
    save: jest.fn((value: typeof lead) => Promise.resolve(value)),
  };
  const deals = {
    findById: jest.fn().mockResolvedValue(deal),
    findByIdForUpdate: jest.fn().mockResolvedValue(deal),
    findByLeadForUpdate: jest.fn().mockResolvedValue(deal),
    findByPortalRemote: jest.fn().mockResolvedValue(null),
    save: jest.fn((value: typeof deal) => Promise.resolve(value)),
  };
  const configurations = { revisions: jest.fn().mockResolvedValue({ mapping: 8 }) };
  const gateway = {
    getLead: jest.fn().mockResolvedValue({ marker: 'aasc-tiktok/lead-1' }),
    getDeal: jest.fn().mockResolvedValue({ marker: 'aasc-tiktok/deal/deal-1' }),
  };
  const reconciliation = { find: jest.fn().mockResolvedValue({ status: 'not_found' }) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const webhookEvents = {
    findByIdForUpdate: jest.fn().mockResolvedValue({ id: 'event-1', advertiserId: 'advertiser-1' }),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const identities = {
    findOwner: jest.fn().mockResolvedValue(null),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
  const dataSource = {
    manager,
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const service = new OperationControlService(
    dataSource as never,
    outbox as never,
    operations as never,
    leads as never,
    deals as never,
    configurations as never,
    gateway as never,
    reconciliation as never,
    webhookEvents as never,
    identities as never,
    auditEvents,
  );
  return {
    service,
    operations,
    leads,
    deals,
    configurations,
    gateway,
    reconciliation,
    outbox,
    webhookEvents,
    identities,
    auditEvents,
  };
}

function input(action: OperationResolveDto['action'], extra: Partial<OperationResolveDto> = {}) {
  return { action, reason: 'Operator verified the CRM state', ...extra };
}

describe('OperationControlService', () => {
  beforeEach(() => manager.query.mockClear());

  it('requires a reason and a dead letter before retrying an operation', async () => {
    const { service, operations } = setup();
    await expect(service.retry('operation-1', ' ', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    operations.findByIdForUpdate.mockResolvedValueOnce(null);
    await expect(service.retry('missing', 'retry', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    operations.findByIdForUpdate.mockResolvedValueOnce(operation({ status: 'processing' }));
    await expect(service.retry('operation-1', 'retry', actor)).rejects.toThrow(
      'Operation is active',
    );
    operations.findByIdForUpdate.mockResolvedValueOnce(operation({ status: 'succeeded' }));
    await expect(service.retry('operation-1', 'retry', actor)).rejects.toThrow(
      'Resolve the operation before retrying it',
    );
  });

  it('requeues a dead letter, clears its lease, and records a redacted audit reason', async () => {
    const { service, outbox, auditEvents } = setup();

    const result = await service.retry(
      'operation-1',
      '  retry email a@example.test token=abc123 +84901234567  ',
      actor,
    );

    expect(result).toMatchObject({
      status: 'pending',
      errorCode: 'REMOTE_TIMEOUT',
      nextAttemptAt: null,
    });
    expect(outbox.append).toHaveBeenCalledWith(
      'operation-1',
      expect.any(String),
      expect.any(Date),
      manager,
    );
    expect(auditEvents.record.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'operation.retry_requested',
      metadata: {
        before: { status: 'dead_letter' },
        after: { status: 'pending' },
        reason: 'retry email [email] token=[redacted] [phone]',
      },
    });
  });

  it('refuses retry when another operation owns the aggregate', async () => {
    const { service, operations, outbox } = setup();
    operations.hasActiveAggregateOperation.mockResolvedValue(true);

    await expect(service.retry('operation-1', 'retry', actor)).rejects.toThrow(
      'Another operation is active',
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects missing, active, and already resolved operations', async () => {
    const { service, operations } = setup();
    operations.findById.mockResolvedValueOnce(null);
    await expect(
      service.resolve('missing', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    operations.findById.mockResolvedValueOnce(operation({ status: 'pending' }));
    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Operation is active');
    operations.findById.mockResolvedValueOnce(operation({ status: 'succeeded' }));
    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Operation does not require resolution');
  });

  it('requires action parameters before entering the resolution transaction', async () => {
    const { service } = setup();
    await expect(service.resolve('operation-1', input('link_remote'), actor)).rejects.toThrow(
      'remoteId is required',
    );
    await expect(
      service.resolve('operation-1', input('select_identity_target'), actor),
    ).rejects.toThrow('targetLeadId is required');
    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', { targetLeadId: 'lead-1' }),
        actor,
      ),
    ).rejects.toThrow('identityTargets are required');
  });

  it('links a verified lead and resumes its sync without creating a duplicate', async () => {
    const { service, leads, outbox, auditEvents } = setup();

    const result = await service.resolve(
      'operation-1',
      input('link_remote', { remoteId: '42' }),
      actor,
    );

    expect(result).toMatchObject({ status: 'pending', remoteId: '42', errorCode: null });
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({
      bitrixLeadId: '42',
      syncStatus: 'pending',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(auditEvents.record.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'operation.resolved.link_remote',
    });
  });

  it('rejects a remote lead with the wrong marker or a conflicting local owner', async () => {
    const { service, gateway, leads } = setup();
    gateway.getLead.mockResolvedValueOnce({ marker: 'aasc-tiktok/other-lead' });
    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Remote lead marker does not match');
    leads.findByPortalRemote.mockResolvedValueOnce({ id: 'other-lead' });
    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Remote lead is linked to another local lead');
  });

  it('turns unexpected CRM lookup failures into a resolution conflict', async () => {
    const { service, gateway } = setup();
    gateway.getLead.mockRejectedValue(new Error('network failed'));

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Remote CRM record could not be verified');
  });

  it('links a verified deal and resumes conversion', async () => {
    const { service, deals, outbox } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );

    const result = await service.resolve(
      'operation-1',
      input('link_remote', { remoteId: '77' }),
      actor,
    );

    expect(result).toMatchObject({ status: 'pending', remoteId: '77' });
    expect(deals.save.mock.calls[0]?.[0]).toMatchObject({ conversionStatus: 'reconcile_required' });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('does not requeue an ingest operation after linking its remote lead', async () => {
    const { service, leads, outbox } = setup(operation({ kind: 'tiktok_ingest' }));

    const result = await service.resolve(
      'operation-1',
      input('link_remote', { remoteId: '42' }),
      actor,
    );

    expect(result).toMatchObject({ status: 'succeeded', remoteId: '42' });
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({ syncStatus: 'synced' });
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('confirms remote absence and creates a new lead sync operation', async () => {
    const { service, reconciliation, operations, outbox } = setup();

    const result = await service.resolve('operation-1', input('confirm_remote_absent'), actor);

    expect(reconciliation.find).toHaveBeenCalledWith('lead', 'aasc-tiktok/lead-1');
    expect(result).toMatchObject({ status: 'pending', configRevisions: { mapping: 1 } });
    expect(operations.create.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'bitrix-lead/lead-1/0/resolution/3',
      payload: { sourceOperationId: 'operation-1', remoteAbsenceConfirmed: true },
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous remote absence and unsupported operation kinds', async () => {
    const { service, reconciliation } = setup();
    reconciliation.find.mockResolvedValueOnce({ status: 'ambiguous' });
    await expect(
      service.resolve('operation-1', input('confirm_remote_absent'), actor),
    ).rejects.toThrow('Remote record is present or its absence is ambiguous');
    const unsupported = setup(operation({ kind: 'tiktok_ingest' }));
    await expect(
      unsupported.service.resolve('operation-1', input('confirm_remote_absent'), actor),
    ).rejects.toThrow('This operation cannot confirm remote absence');
  });

  it('reprocesses with current revisions and skips occupied operation keys', async () => {
    const { service, operations, configurations, leads } = setup(
      operation({ status: 'quarantined' }),
    );
    operations.findByKey.mockResolvedValueOnce(operation()).mockResolvedValueOnce(null);
    leads.findByIdForUpdate.mockResolvedValueOnce({
      id: 'lead-1',
      advertiserId: 'advertiser-1',
      portalKey: 'portal-1',
      bitrixLeadId: null,
      syncStatus: 'failed',
      lastErrorCode: 'REMOTE_TIMEOUT',
    });

    const result = await service.resolve(
      'operation-1',
      input('reprocess_with_current_config'),
      actor,
    );

    expect(result).toMatchObject({ status: 'pending', configRevisions: { mapping: 8 } });
    expect(configurations.revisions).toHaveBeenCalledWith(manager);
    expect(operations.create.mock.calls[0]?.[0].operationKey).toBe(
      'bitrix-lead/lead-1/0/resolution/4',
    );
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({
      syncStatus: 'pending',
      lastErrorCode: null,
    });
  });

  it('prevents replay of a lead creation that still requires reconciliation', async () => {
    const { service } = setup();

    await expect(
      service.resolve('operation-1', input('reprocess_with_current_config'), actor),
    ).rejects.toThrow('Confirm remote absence before replaying lead creation');
  });

  it('prevents a completed deal conversion from being reprocessed', async () => {
    const { service, deals } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );
    deals.findByLeadForUpdate.mockResolvedValue({ id: 'deal-1', conversionStatus: 'completed' });

    await expect(
      service.resolve('operation-1', input('reprocess_with_current_config'), actor),
    ).rejects.toThrow('Completed conversion cannot be reprocessed');
  });

  it('rejects a retry for an operation kind with no retry queue', async () => {
    const { service, outbox } = setup(operation({ kind: 'unsupported' as never }));

    await expect(service.retry('operation-1', 'retry', actor)).rejects.toThrow(
      'Operation kind cannot be retried',
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects resolution when another transaction changed the operation state', async () => {
    const { service, operations, outbox } = setup();
    operations.findByIdForUpdate.mockResolvedValueOnce(operation({ status: 'processing' }));

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Operation state changed during resolution');
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects linking when the local lead has disappeared', async () => {
    const { service, leads } = setup();
    leads.findById.mockResolvedValueOnce(null);

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Lead was not found');
  });

  it('rejects linking a deal that belongs to another local record', async () => {
    const { service, deals } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );
    deals.findByPortalRemote.mockResolvedValueOnce({ id: 'other-deal' });

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '77' }), actor),
    ).rejects.toThrow('Remote deal is linked to another local deal');
  });

  it('verifies remote absence for a deal before creating a replay', async () => {
    const { service, reconciliation, deals } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );

    const result = await service.resolve('operation-1', input('confirm_remote_absent'), actor);

    expect(reconciliation.find).toHaveBeenCalledWith('deal', 'aasc-tiktok/deal/deal-1');
    expect(result).toMatchObject({ status: 'pending' });
    expect(deals.save.mock.calls[0]?.[0]).toMatchObject({
      conversionStatus: 'pending',
      version: 2,
    });
  });

  it('refuses current config replay while a deal side effect still needs resolution', async () => {
    const { service } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );

    await expect(
      service.resolve('operation-1', input('reprocess_with_current_config'), actor),
    ).rejects.toThrow('Resolve the remote conversion side effect before reprocessing it');
  });

  it('selects a verified identity target and requeues the TikTok ingest event', async () => {
    const { service, identities, webhookEvents, outbox, operations } = setup(
      operation({ kind: 'tiktok_ingest', payload: { eventId: 'event-1' } }),
    );

    const result = await service.resolve(
      'operation-1',
      input('select_identity_target', {
        targetLeadId: 'lead-1',
        identityTargets: { email: ' an@example.test ' },
      }),
      actor,
    );

    expect(result).toMatchObject({ status: 'pending' });
    expect(identities.save.mock.calls[0]?.[0]).toMatchObject({
      leadId: 'lead-1',
      identityType: 'email',
      normalizedValue: 'an@example.test',
    });
    expect(webhookEvents.save.mock.calls[0]?.[0]).toMatchObject({ status: 'accepted' });
    expect(operations.save.mock.calls[0]?.[0].payload).toMatchObject({
      resolvedTargetLeadId: 'lead-1',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('rejects identity selection outside the event advertiser scope', async () => {
    const { service, webhookEvents, outbox } = setup(
      operation({ kind: 'tiktok_ingest', payload: { eventId: 'event-1' } }),
    );
    webhookEvents.findByIdForUpdate.mockResolvedValueOnce({
      id: 'event-1',
      advertiserId: 'another-advertiser',
    });

    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { email: 'an@example.test' },
        }),
        actor,
      ),
    ).rejects.toThrow('Identity target is outside the operation scope');
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects unsafe identity types and identities owned by another lead', async () => {
    const { service, identities } = setup(
      operation({ kind: 'tiktok_ingest', payload: { eventId: 'event-1' } }),
    );
    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { password: 'secret' },
        }),
        actor,
      ),
    ).rejects.toThrow('Identity selection must contain normalized email or phone values');
    identities.findOwner.mockResolvedValueOnce({ leadId: 'other-lead' });
    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { phone: '+84901234567' },
        }),
        actor,
      ),
    ).rejects.toThrow('Identity is already owned by another lead');
  });

  it('rejects identity selection on a non-ingest operation', async () => {
    const { service } = setup();

    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { email: 'an@example.test' },
        }),
        actor,
      ),
    ).rejects.toThrow('Identity selection only applies to TikTok ingest operations');
  });

  it('rejects lead linking when its operation has no local lead scope', async () => {
    const { service, gateway } = setup(operation({ aggregateId: null, payload: {} }));

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Operation has no lead scope');
    expect(gateway.getLead).not.toHaveBeenCalled();
  });

  it('rejects deal linking without a deal scope or with a wrong CRM marker', async () => {
    const missing = setup(operation({ kind: 'bitrix_deal_convert', payload: {} }));
    await expect(
      missing.service.resolve('operation-1', input('link_remote', { remoteId: '77' }), actor),
    ).rejects.toThrow('Operation has no deal scope');
    const wrong = setup(operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }));
    wrong.gateway.getDeal.mockResolvedValueOnce({ marker: 'aasc-tiktok/deal/other' });
    await expect(
      wrong.service.resolve('operation-1', input('link_remote', { remoteId: '77' }), actor),
    ).rejects.toThrow('Remote deal marker does not match');
  });

  it('rejects linking a CRM record to an unsupported operation kind', async () => {
    const { service } = setup(operation({ kind: 'crm_timeline' }));

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('This operation cannot link a remote CRM record');
  });

  it('refuses a lead link when the local row disappeared after marker verification', async () => {
    const { service, leads } = setup();
    leads.findByIdForUpdate.mockResolvedValueOnce(null);

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '42' }), actor),
    ).rejects.toThrow('Lead was not found');
  });

  it('refuses a deal link when its local row disappeared after marker verification', async () => {
    const { service, deals } = setup(
      operation({ kind: 'bitrix_deal_convert', payload: { dealId: 'deal-1' } }),
    );
    deals.findByIdForUpdate.mockResolvedValueOnce(null);

    await expect(
      service.resolve('operation-1', input('link_remote', { remoteId: '77' }), actor),
    ).rejects.toThrow('Deal was not found');
  });

  it('does not duplicate an identity already owned by the selected lead', async () => {
    const { service, identities, outbox } = setup(
      operation({ kind: 'tiktok_ingest', payload: { eventId: 'event-1' } }),
    );
    identities.findOwner.mockResolvedValueOnce({ leadId: 'lead-1' });

    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { email: 'an@example.test' },
        }),
        actor,
      ),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(identities.save).not.toHaveBeenCalled();
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('refuses identity selection when the operation became active before row locking', async () => {
    const { service, operations } = setup(
      operation({ kind: 'tiktok_ingest', payload: { eventId: 'event-1' } }),
    );
    operations.findByIdForUpdate.mockResolvedValueOnce(operation({ status: 'processing' }));

    await expect(
      service.resolve(
        'operation-1',
        input('select_identity_target', {
          targetLeadId: 'lead-1',
          identityTargets: { email: 'an@example.test' },
        }),
        actor,
      ),
    ).rejects.toThrow('Operation state changed during resolution');
  });
});
