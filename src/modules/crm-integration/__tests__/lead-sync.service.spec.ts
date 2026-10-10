import {
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { LeadSyncService } from '../services/lead-sync.service.js';
import { FALLBACK_MAPPING } from '../constants/flow.constants.js';

function setup() {
  const manager = {};
  const dataSource = {
    manager,
    transaction: jest.fn((callback: (tx: object) => Promise<unknown>) => callback(manager)),
  };
  const lead = {
    id: 'lead-1',
    advertiserId: 'advertiser-1',
    portalKey: 'portal-1',
    version: 2,
    syncStatus: 'pending',
    bitrixLeadId: null as string | null,
    lastWrittenFields: {},
    fieldProvenance: {},
    name: 'An',
    email: 'an@example.test',
    phone: null,
    city: 'Hanoi',
    interests: [],
    lastErrorCode: null,
  };
  const submission = {
    eventId: 'event-1',
    providerLeadId: 'provider-1',
    occurredAt: new Date('2026-10-01T00:00:00Z'),
    campaignId: null,
    campaignName: null,
    adId: null,
    adName: null,
    formId: null,
    formName: null,
    ttclid: null,
    utm: {},
    customAnswers: {},
    consent: {},
    isHistorical: false,
    applyRules: true,
    sendFeedback: true,
  };
  const remote = {
    id: '42',
    title: 'An',
    marker: 'aasc-tiktok/lead-1',
    fields: { title: 'TikTok - An - Lead' } as Record<string, unknown>,
    stale: false,
  };
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    findByIdForUpdate: jest.fn().mockResolvedValue(lead),
    findByPortalRemote: jest.fn().mockResolvedValue(null),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const submissions = { findLatestForLead: jest.fn().mockResolvedValue(submission) };
  const configurations = { findRevision: jest.fn().mockResolvedValue(null) };
  const analytics = { increment: jest.fn().mockResolvedValue(undefined) };
  const gateway = {
    getLead: jest.fn().mockResolvedValue(remote),
    findLeadDuplicates: jest.fn().mockResolvedValue([]),
    createLead: jest.fn().mockResolvedValue(remote),
    updateLead: jest.fn().mockResolvedValue(remote),
  };
  const reconciliation = { find: jest.fn().mockResolvedValue({ status: 'not_found' }) };
  const operations = {
    findByKey: jest.fn().mockResolvedValue(null),
    ensure: jest.fn().mockResolvedValue({ id: 'operation-2' }),
  };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const timeline = { append: jest.fn().mockResolvedValue('timeline-1') };
  const context = {
    revisions: { mapping: 0, rules: 0, scoring: 0 },
    acquireAggregateLease: jest.fn().mockResolvedValue('lease-1'),
    assertOwnership: jest.fn().mockResolvedValue(undefined),
    releaseAggregateLease: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LeadSyncService(
    dataSource as never,
    leads as never,
    submissions as never,
    configurations as never,
    analytics,
    gateway as never,
    reconciliation as never,
    operations as never,
    outbox as never,
    timeline as never,
  );
  return {
    service,
    lead,
    submission,
    remote,
    leads,
    submissions,
    configurations,
    analytics,
    gateway,
    reconciliation,
    operations,
    outbox,
    timeline,
    context,
  };
}

describe('LeadSyncService', () => {
  it('defers work without touching CRM when the aggregate lease is busy', async () => {
    const { service, context, gateway } = setup();
    context.acquireAggregateLease.mockResolvedValueOnce(null);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'LEAD_SYNC_LEASE_BUSY',
      deferred: true,
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('quarantines a missing local lead and releases its lease', async () => {
    const { service, leads, context } = setup();
    leads.findById.mockResolvedValueOnce(null);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'LEAD_NOT_FOUND',
    });
    expect(context.releaseAggregateLease).toHaveBeenCalledWith('lease-1');
  });

  it('skips an obsolete version and queues the latest unsynced version once', async () => {
    const { service, context, operations, outbox, gateway } = setup();

    await expect(service.sync('lead-1', 1, context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'bitrix-lead-sync/lead-1/2',
      targetVersion: 2,
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('does not queue an obsolete version that has already been synced', async () => {
    const { service, lead, context, outbox } = setup();
    lead.syncStatus = 'synced';
    await expect(service.sync('lead-1', 1, context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('requires operator reconciliation when a marker identifies multiple CRM leads', async () => {
    const { service, reconciliation, leads, context } = setup();
    reconciliation.find.mockResolvedValueOnce({ status: 'ambiguous' });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'LEAD_MARKER_AMBIGUOUS',
    });
    expect(leads.update).toHaveBeenCalledWith(
      'lead-1',
      {
        syncStatus: 'reconcile_required',
        lastErrorCode: 'LEAD_MARKER_AMBIGUOUS',
      },
      expect.anything(),
    );
  });

  it('uses a linked remote ID when marker lookup misses', async () => {
    const { service, lead, context, gateway } = setup();
    lead.bitrixLeadId = '42';

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(gateway.getLead).toHaveBeenCalledWith('42');
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('retries a failed linked-record lookup without creating another lead', async () => {
    const { service, lead, context, gateway } = setup();
    lead.bitrixLeadId = '42';
    gateway.getLead.mockRejectedValueOnce(new GatewayTimeoutException());

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CRM_REMOTE_GET_FAILED',
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('uses distinct retry codes for CRM throttling and outages', async () => {
    for (const [error, errorCode] of [
      [new HttpException('throttled', 429), 'CRM_RATE_LIMITED'],
      [new ServiceUnavailableException(), 'CRM_UNAVAILABLE'],
      [new GatewayTimeoutException(), 'LEAD_SYNC_FAILED'],
    ] as const) {
      const { service, context } = setup();
      context.assertOwnership.mockRejectedValueOnce(error);

      await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
        outcome: 'retry_wait',
        errorCode,
      });
    }
  });

  it('treats a missing linked CRM record as an unlinked lead', async () => {
    const { service, lead, context, gateway } = setup();
    lead.bitrixLeadId = 'gone';
    gateway.getLead.mockRejectedValueOnce(new NotFoundException());

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(gateway.createLead).toHaveBeenCalledTimes(1);
  });

  it('quarantines a lead with no submission before making a CRM request', async () => {
    const { service, submissions, gateway, context } = setup();
    submissions.findLatestForLead.mockResolvedValueOnce(null);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'LEAD_SUBMISSION_MISSING',
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('retries when contact duplicate lookup is unavailable', async () => {
    const { service, gateway, context } = setup();
    gateway.findLeadDuplicates.mockRejectedValueOnce(new Error('unavailable'));

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CRM_DUPLICATE_LOOKUP_UNAVAILABLE',
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('quarantines multiple contact candidates before creating a CRM lead', async () => {
    const { service, gateway, leads, context } = setup();
    gateway.findLeadDuplicates.mockResolvedValueOnce([
      { id: '42', marker: null, fields: {} },
      { id: '43', marker: null, fields: {} },
    ]);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CRM_DUPLICATE_CANDIDATES_AMBIGUOUS',
    });
    expect(leads.update).toHaveBeenCalledWith(
      'lead-1',
      {
        syncStatus: 'failed',
        lastErrorCode: 'CRM_DUPLICATE_CANDIDATES_AMBIGUOUS',
      },
      expect.anything(),
    );
  });

  it('refuses to adopt a CRM lead owned by another integration', async () => {
    const { service, gateway, context } = setup();
    gateway.findLeadDuplicates.mockResolvedValueOnce([
      { id: '42', marker: null, foreignOrigin: true, fields: {} },
    ]);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CRM_DUPLICATE_OWNED_BY_OTHER_LEAD',
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('refuses to adopt a CRM lead linked to another local lead', async () => {
    const { service, gateway, leads, context } = setup();
    gateway.findLeadDuplicates.mockResolvedValueOnce([{ id: '42', marker: null, fields: {} }]);
    leads.findByPortalRemote.mockResolvedValueOnce({ id: 'other-lead' });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CRM_DUPLICATE_OWNED_BY_OTHER_LEAD',
    });
  });

  it('creates and persists a lead when no safe CRM candidate exists', async () => {
    const { service, context, gateway, leads, timeline, analytics } = setup();

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(gateway.createLead.mock.calls[0]?.[1]).toBe('aasc-tiktok/lead-1');
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({
      bitrixLeadId: '42',
      syncStatus: 'synced',
    });
    expect(timeline.append).toHaveBeenCalledTimes(1);
    expect(analytics.increment).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected create without requiring operator reconciliation', async () => {
    const { service, context, gateway, reconciliation } = setup();
    gateway.createLead.mockRejectedValueOnce(new UnprocessableEntityException());

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CRM_CREATE_REJECTED',
    });
    expect(reconciliation.find).toHaveBeenCalledTimes(1);
  });

  it('adopts a CRM lead found after an ambiguous create timeout', async () => {
    const { service, context, gateway, reconciliation } = setup();
    gateway.createLead.mockRejectedValueOnce(new GatewayTimeoutException());
    reconciliation.find.mockResolvedValueOnce({ status: 'not_found' }).mockResolvedValueOnce({
      status: 'found',
      value: { id: '42', marker: 'aasc-tiktok/lead-1', fields: {} },
    });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      remoteId: '42',
    });
  });

  it('quarantines an ambiguous marker found after a create timeout', async () => {
    const { service, context, gateway, reconciliation } = setup();
    gateway.createLead.mockRejectedValueOnce(new GatewayTimeoutException());
    reconciliation.find
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockResolvedValueOnce({ status: 'ambiguous' });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'LEAD_MARKER_AMBIGUOUS',
    });
  });

  it('schedules reconciliation when create may have succeeded but lookup is still empty', async () => {
    const { service, context, gateway, operations, outbox } = setup();
    gateway.createLead.mockRejectedValueOnce(new GatewayTimeoutException());

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'CRM_CREATE_AMBIGUOUS',
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'bitrix-lead-reconcile/lead-1/2/1',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('does not persist a stale snapshot returned by CRM', async () => {
    const { service, remote, reconciliation, leads, context } = setup();
    remote.stale = true;
    reconciliation.find.mockResolvedValueOnce({ status: 'found', value: remote });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CRM_REMOTE_SNAPSHOT_STALE',
    });
    expect(leads.save).not.toHaveBeenCalled();
  });

  it('requeues a newer local version created while the CRM update was in flight', async () => {
    const { service, lead, context, reconciliation, leads, operations } = setup();
    const snapshot = { ...lead };
    const locked = { ...lead, version: 3 };
    leads.findById.mockResolvedValueOnce(snapshot);
    leads.findByIdForUpdate.mockResolvedValueOnce(locked);
    reconciliation.find.mockResolvedValueOnce({
      status: 'found',
      value: { id: '42', marker: 'aasc-tiktok/lead-1', fields: {} },
    });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(leads.save.mock.calls[0]?.[0]).toMatchObject({ syncStatus: 'pending', version: 3 });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({ targetVersion: 3 });
  });

  it('schedules read-only reconciliation for a lead whose prior create remains ambiguous', async () => {
    const { service, lead, operations, context, gateway } = setup();
    lead.syncStatus = 'reconcile_required';

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(operations.ensure.mock.calls[0]?.[0]).toMatchObject({
      operationKey: 'bitrix-lead-reconcile/lead-1/2/1',
      payload: { reconciliationAttempt: 1 },
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('stops scheduling reconciliation after its lookup budget is exhausted', async () => {
    const { service, lead, outbox, context } = setup();
    lead.syncStatus = 'reconcile_required';

    await expect(service.sync('lead-1', 2, context as never, 100)).resolves.toEqual({
      outcome: 'reconcile_required',
      errorCode: 'CRM_RECONCILIATION_EXHAUSTED',
    });
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('refuses a duplicate carrying another local lead marker', async () => {
    const { service, gateway, context } = setup();
    gateway.findLeadDuplicates.mockResolvedValueOnce([
      { id: '42', marker: 'aasc-tiktok/another-lead', fields: {} },
    ]);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'quarantined',
      errorCode: 'CRM_DUPLICATE_OWNED_BY_OTHER_LEAD',
    });
  });

  it('rejects a stored mapping revision without compiled entries', async () => {
    const { service, context, configurations, gateway } = setup();
    context.revisions.mapping = 4;
    configurations.findRevision.mockResolvedValueOnce({ value: { compiled: { invalid: true } } });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'LEAD_SYNC_FAILED',
    });
    expect(gateway.createLead).not.toHaveBeenCalled();
  });

  it('uses a valid stored mapping revision and skips an unchanged remote patch', async () => {
    const { service, context, remote, reconciliation, configurations, gateway, leads } = setup();
    context.revisions.mapping = 1;
    configurations.findRevision.mockResolvedValueOnce({ value: { compiled: FALLBACK_MAPPING } });
    remote.fields = {
      title: 'TikTok - An - Lead',
      city: 'Hanoi',
      fm: [{ typeId: 'EMAIL', value: 'an@example.test', valueType: 'WORK' }],
      name: 'An',
    };
    reconciliation.find.mockResolvedValueOnce({ status: 'found', value: remote });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(gateway.updateLead).not.toHaveBeenCalled();
    expect(leads.save).toHaveBeenCalled();
  });

  it('falls back to the built-in mapping when the requested revision is missing', async () => {
    const { service, context, configurations, reconciliation, remote } = setup();
    context.revisions.mapping = 9;
    configurations.findRevision.mockResolvedValueOnce(null);
    reconciliation.find.mockResolvedValueOnce({ status: 'found', value: remote });

    await expect(service.sync('lead-1', 2, context as never)).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(configurations.findRevision).toHaveBeenCalledWith('mapping', 9);
  });

  it('does not recreate a newer sync operation when one already exists', async () => {
    const { service, operations, outbox, context } = setup();
    operations.findByKey.mockResolvedValueOnce({ id: 'existing-operation' });

    await expect(service.sync('lead-1', 1, context as never)).resolves.toEqual({
      outcome: 'succeeded',
    });
    expect(operations.ensure).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('keeps the CRM result when its local lead row vanished before persistence', async () => {
    const { service, leads, outbox, context } = setup();
    leads.findByIdForUpdate.mockResolvedValueOnce(null);

    await expect(service.sync('lead-1', 2, context as never)).resolves.toEqual({
      outcome: 'succeeded',
      remoteId: '42',
    });
    expect(leads.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
