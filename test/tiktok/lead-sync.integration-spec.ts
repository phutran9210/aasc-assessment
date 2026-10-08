import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { BitrixCoreModule, BITRIX_CONFIG } from '../../src/modules/bitrix/bitrix-core.module.js';
import { BITRIX_INSTALLATION_STORE } from '../../src/modules/bitrix/ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '../../src/modules/bitrix/ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '../../src/modules/bitrix/ports/bitrix-request-limiter.port.js';
import { AggregateLeaseRepository } from '../../src/core/queue/repositories/aggregate-lease.repository.js';
import { OperationRepository } from '../../src/core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '../../src/core/queue/repositories/outbox.repository.js';
import { OperationEntity } from '../../src/core/queue/entities/operation.entity.js';
import { TimelineEntity } from '../../src/modules/crm-integration/entities/timeline.entity.js';
import { LeadEntity } from '../../src/modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '../../src/modules/crm-integration/entities/submission.entity.js';
import { WebhookEventEntity } from '../../src/core/queue/entities/webhook-event.entity.js';
import { BitrixCrmGateway } from '../../src/modules/crm-integration/gateways/bitrix-crm.gateway.js';
import { RemoteReconciliationService } from '../../src/modules/crm-integration/services/remote-reconciliation.service.js';
import { TimelineService } from '../../src/modules/crm-integration/services/timeline.service.js';
import { LeadSyncService } from '../../src/modules/crm-integration/services/lead-sync.service.js';
import type { CrmGateway } from '../../src/modules/crm-integration/ports/crm-gateway.port.js';
import { ProviderServer } from '../../src/modules/tiktok/testing/provider-server.js';
import { BitrixStore } from '../../src/modules/tiktok/testing/bitrix-store.js';
import { TiktokStore } from '../../src/modules/tiktok/testing/tiktok-store.js';
import type { OperationContext } from '../../src/core/queue/types/worker.types.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

describe('Bitrix lead synchronization', () => {
  let infrastructure: TestInfrastructure;
  let server: ProviderServer;
  let crmStore: BitrixStore;
  let gateway: BitrixCrmGateway;
  let moduleRef: TestingModule;
  let syncService: LeadSyncService;
  let timelineService: TimelineService;
  let leases: AggregateLeaseRepository;
  const operations = new OperationRepository();
  const outbox = new OutboxRepository();

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    crmStore = new BitrixStore();
    server = new ProviderServer({
      bitrix: crmStore,
      tiktok: new TiktokStore(),
      exposeControl: true,
    });
    await server.listen();
    const core = BitrixCoreModule.register({
      providers: [
        {
          provide: BITRIX_CONFIG,
          useValue: {
            clientId: '',
            clientSecret: '',
            portalDomain: '',
            requisitePresetId: 0,
            webhookUrl: server.bitrixEndpoint,
            timeoutMs: 100,
            stateTtlSeconds: 60,
            refreshSkewSeconds: 60,
          },
        },
        { provide: BITRIX_INSTALLATION_STORE, useValue: {} },
        {
          provide: BITRIX_REQUEST_LIMITER,
          useValue: { acquire: () => Promise.resolve(), saturate: () => Promise.resolve() },
        },
        {
          provide: BITRIX_OAUTH_STATE_STORE,
          useValue: { issue: () => Promise.resolve('state'), consume: () => Promise.resolve(true) },
        },
      ],
    });
    moduleRef = await Test.createTestingModule({
      imports: [core],
      providers: [BitrixCrmGateway],
    }).compile();
    gateway = moduleRef.get(BitrixCrmGateway);
    const reconciliation = new RemoteReconciliationService(gateway);
    timelineService = new TimelineService(
      infrastructure.database.dataSource,
      gateway,
      reconciliation,
      operations,
      outbox,
    );
    syncService = new LeadSyncService(
      infrastructure.database.dataSource,
      gateway,
      reconciliation,
      operations,
      outbox,
      timelineService,
      'VN',
    );
    leases = new AggregateLeaseRepository(infrastructure.database.dataSource);
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.close();
    await infrastructure.close();
  });

  it('runs version 2 first and prevents a later version 1 operation from overwriting it', async () => {
    const leadId = await saveLead(2, 'Version 2 name');
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    await expect(syncService.sync(leadId, 2, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    const remote = crmStore.calls.find((call) => call.method === 'crm.item.add');

    expect(remote?.payload.fields).toMatchObject({ name: 'Version 2 name' });
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 1,
    );
  });

  it('finds a lead persisted before a create timeout and never creates it twice', async () => {
    const leadId = await saveLead(1, 'Timeout recovery');
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    crmStore.injectFault('crm.item.add', 'persist_then_timeout');

    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 1,
    );
    expect(
      await infrastructure.database.dataSource
        .getRepository(LeadEntity)
        .findOneByOrFail({ id: leadId }),
    ).toMatchObject({
      syncStatus: 'synced',
      bitrixLeadId: expect.any(String),
    });
    expect(
      await infrastructure.database.dataSource
        .getRepository(TimelineEntity)
        .count({ where: { leadId } }),
    ).toBe(1);
  });

  it('does not create when marker lookup is rate limited and reconciles existing markers first', async () => {
    const leadId = await saveLead(1, 'Lookup failure');
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    crmStore.injectFault('crm.item.list', 'rate_limit');

    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'retry_wait',
    });
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore,
    );
  });

  it('serializes two operations for one lead with the aggregate lease', async () => {
    const leadId = await saveLead(1, 'Concurrent lead');
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    const outcomes = await Promise.all([
      syncService.sync(leadId, 1, context()),
      syncService.sync(leadId, 1, context()),
    ]);

    expect(outcomes.some((outcome) => outcome.outcome === 'retry_wait')).toBe(true);
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 1,
    );
  });

  it('does not create when duplicate lookup returns 503', async () => {
    const leadId = await saveLead(1, 'Duplicate lookup outage');
    const failingGateway = Object.create(gateway) as CrmGateway;
    failingGateway.findLeadDuplicates = () =>
      Promise.reject(new Error('mock duplicate service unavailable'));
    const service = new LeadSyncService(
      infrastructure.database.dataSource,
      failingGateway,
      new RemoteReconciliationService(gateway),
      operations,
      outbox,
      timelineService,
      'VN',
    );
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;

    await expect(service.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'CRM_DUPLICATE_LOOKUP_UNAVAILABLE',
    });
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore,
    );
  });

  it('quarantines multiple contact matches rather than creating or linking arbitrarily', async () => {
    const leadId = await saveLead(1, 'Ambiguous duplicate');
    const lead = await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .findOneByOrFail({ id: leadId });
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    await gateway.createLead({ title: 'Existing candidate A', email: lead.email }, 'existing-a');
    await gateway.createLead({ title: 'Existing candidate B', email: lead.email }, 'existing-b');

    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'quarantined',
      errorCode: 'CRM_DUPLICATE_CANDIDATES_AMBIGUOUS',
    });
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 2,
    );
  });

  it('recovers a stored remote ID that now returns 404 by reconciling before creating again', async () => {
    const leadId = await saveLead(1, 'Remote ID deleted');
    await infrastructure.database.dataSource.getRepository(LeadEntity).update(leadId, {
      bitrixLeadId: 'missing-remote-id',
    });
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;

    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    const lead = await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .findOneByOrFail({ id: leadId });
    expect(lead.bitrixLeadId).not.toBe('missing-remote-id');
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 1,
    );
  });

  it('reconciles timeline comments after a persist-then-timeout without posting twice', async () => {
    const leadId = await saveLead(1, 'Timeline reconciliation');
    const timelineId = await timelineService.append(
      {
        leadId,
        entityType: 'lead',
        entityId: 'remote-timeline-lead',
        marker: `timeline/${leadId}/unique`,
        comment: 'Sync checkpoint',
      },
      context(),
    );
    const addsBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.timeline.comment.add',
    ).length;
    crmStore.injectFault('crm.timeline.comment.add', 'persist_then_timeout');

    await expect(timelineService.execute(timelineId, context())).resolves.toMatchObject({
      outcome: 'reconcile_required',
    });
    await expect(timelineService.execute(timelineId, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    expect(
      crmStore.calls.filter((call) => call.method === 'crm.timeline.comment.add'),
    ).toHaveLength(addsBefore + 1);
    expect(
      await infrastructure.database.dataSource
        .getRepository(TimelineEntity)
        .findOneByOrFail({ id: timelineId }),
    ).toMatchObject({ status: 'posted', remoteTimelineId: '1' });
  });

  it('reconciles an ambiguous create on 5/15/30 second checkpoints without adding twice', async () => {
    const leadId = await saveLead(1, 'No remote result');
    const createsBefore = crmStore.calls.filter((call) => call.method === 'crm.item.add').length;
    crmStore.injectFault('crm.item.add', 'timeout_without_persist');

    await expect(syncService.sync(leadId, 1, context())).resolves.toMatchObject({
      outcome: 'reconcile_required',
      errorCode: 'CRM_CREATE_AMBIGUOUS',
    });
    for (const attempt of [1, 2, 3]) {
      await expect(syncService.sync(leadId, 1, context(), attempt)).resolves.toMatchObject({
        outcome: 'reconcile_required',
      });
    }

    const retries = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .createQueryBuilder('operation')
      .where('operation.operationKey LIKE :prefix', { prefix: `bitrix-lead-reconcile/${leadId}/%` })
      .getMany();
    expect(retries).toHaveLength(3);
    expect(crmStore.calls.filter((call) => call.method === 'crm.item.add')).toHaveLength(
      createsBefore + 1,
    );
    expect(
      await infrastructure.database.dataSource
        .getRepository(LeadEntity)
        .findOneByOrFail({ id: leadId }),
    ).toMatchObject({ syncStatus: 'reconcile_required', bitrixLeadId: null });
  });

  async function saveLead(version: number, name: string): Promise<string> {
    const dataSource = infrastructure.database.dataSource;
    const id = randomUUID();
    const eventKey = `sync-${randomUUID()}`;
    const payload = { lead_data: { full_name: name, email: `${id}@example.test` } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    await dataSource.getRepository(WebhookEventEntity).save({
      id: randomUUID(),
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'sync-test',
      advertiserId: 'sync-test',
      portalKey: null,
      eventKey,
      eventType: 'lead.generate',
      occurredAt: new Date(),
      receivedAt: new Date(),
      rawBody,
      payload,
      payloadHash: 'a'.repeat(64),
      status: 'processed',
      errorCode: null,
    });
    const event = await dataSource.getRepository(WebhookEventEntity).findOneByOrFail({ eventKey });
    const submissionId = randomUUID();
    await dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `external-${id}`,
      advertiserId: 'sync-test',
      scopeKey: 'sync-test',
      portalKey: 'portal-test',
      providerMode: 'mock',
      name,
      email: `${id}@example.test`,
      phone: null,
      city: 'Hanoi',
      interests: [],
      score: 30,
      scoreVersion: 1,
      scoreBreakdown: {},
      businessStatus: 'new',
      syncStatus: 'pending',
      bitrixLeadId: null,
      firstSubmissionId: null,
      lastSubmissionId: null,
      firstTouchAt: new Date(),
      firstTouchCampaignId: 'campaign-1',
      lastTouchAt: new Date(),
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version,
      lastErrorCode: null,
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      advertiserId: 'sync-test',
      providerMode: 'mock',
      leadId: id,
      eventId: event.id,
      providerLeadId: null,
      submissionKey: eventKey,
      campaignId: 'campaign-1',
      campaignName: 'Campaign',
      adId: null,
      adName: null,
      formId: 'form-1',
      formName: 'Form',
      ttclid: null,
      utm: {},
      customAnswers: {},
      engagement: {},
      consent: {},
      occurredAt: new Date(),
      isHistorical: false,
      applyRules: true,
      sendFeedback: true,
      payloadHash: 'a'.repeat(64),
      associationStatus: 'linked',
      linkAttemptCount: 0,
      nextLinkAttemptAt: null,
      associationExpiresAt: null,
    });
    await dataSource.getRepository(LeadEntity).update(id, {
      firstSubmissionId: submissionId,
      lastSubmissionId: submissionId,
    });
    return id;
  }

  function context(): OperationContext {
    return {
      operationId: randomUUID(),
      ownerToken: randomUUID(),
      attempt: 1,
      revisions: { mapping: 0, rules: 0, scoring: 1 },
      signal: new AbortController().signal,
      assertOwnership: () => Promise.resolve(),
      acquireAggregateLease: (key) => leases.claim(key, 60_000),
      releaseAggregateLease: (lease) => leases.release(lease),
    };
  }
});
