import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { BitrixCoreModule, BITRIX_CONFIG } from '@modules/bitrix/bitrix-core.module.js';
import { BITRIX_INSTALLATION_STORE } from '@modules/bitrix/ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '@modules/bitrix/ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '@modules/bitrix/ports/bitrix-request-limiter.port.js';
import { AggregateLeaseRepository } from '@core/queue/repositories/aggregate-lease.repository.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { AssignmentCursorEntity } from '@modules/crm-integration/entities/assignment-cursor.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import { AnalyticsRevisionEntity } from '@modules/integration-analytics/entities/analytics-revision.entity.js';
import { BitrixCrmGateway } from '@modules/crm-integration/gateways/bitrix-crm.gateway.js';
import { AssignmentCursorRepository } from '@modules/crm-integration/repositories/assignment-cursor.repository.js';
import { AssignmentService } from '@modules/crm-integration/services/assignment.service.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { ConversionService } from '@modules/crm-integration/services/conversion.service.js';
import { RemoteReconciliationService } from '@modules/crm-integration/services/remote-reconciliation.service.js';
import { TimelineService } from '@modules/crm-integration/services/timeline.service.js';
import { TimelineRepository } from '@modules/crm-integration/repositories/timeline.repository.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import { DealRepository } from '@modules/crm-integration/repositories/deal.repository.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { OPERATION_KINDS } from '@core/queue/constants/operation.constants.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

describe('TikTok lead conversion saga', () => {
  let infrastructure: TestInfrastructure;
  let server: ProviderServer;
  let crmStore: BitrixStore;
  let gateway: BitrixCrmGateway;
  let moduleRef: TestingModule;
  let conversions: ConversionService;
  let leases: AggregateLeaseRepository;
  let configurationRevision = 0;
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
            requisitePresetId: 1,
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
    const dataSource = infrastructure.database.dataSource;
    const reconciliation = new RemoteReconciliationService(gateway);
    const timeline = new TimelineService(
      dataSource,
      gateway,
      reconciliation,
      operations,
      outbox,
      new TimelineRepository(),
    );
    conversions = new ConversionService(
      dataSource,
      new ConfigurationRepository(dataSource),
      new AssignmentService(new AssignmentCursorRepository()),
      operations,
      outbox,
      gateway,
      reconciliation,
      timeline,
      new LeadRepository(),
      new SubmissionRepository(),
      new DealRepository(dataSource),
      new AnalyticsRevisionRepository(),
    );
    leases = new AggregateLeaseRepository(dataSource);
  });

  beforeEach(async () => {
    await infrastructure.database.dataSource
      .getRepository(AnalyticsRevisionEntity)
      .update('00000000-0000-7000-8000-000000000001', { revision: '0' });
    configurationRevision =
      (
        await infrastructure.database.dataSource
          .getRepository(ConfigurationHeadEntity)
          .findOneBy({ key: 'rules' })
      )?.revision ?? 0;
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.close();
    await infrastructure.close();
  });

  it('uses one conversion operation and advances round-robin once for concurrent auto and manual requests', async () => {
    const leadId = await saveLead();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        conversions.request(leadId, index % 2 ? 'manual' : 'rule', undefined),
      ),
    );
    const deal = await infrastructure.database.dataSource
      .getRepository(DealEntity)
      .findOneByOrFail({ leadId });
    const pending = results.find((item) => item?.status === 'pending');
    if (!pending || pending.status !== 'pending') throw new Error('expected pending receipt');
    const dealCreatesBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    ).length;
    await expect(conversions.execute(pending.operationId, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    const cursor = await infrastructure.database.dataSource
      .getRepository(AssignmentCursorEntity)
      .findOneByOrFail({ cursorKey: 'default' });

    expect(
      new Set(
        results.map((item) =>
          item?.status === 'pending'
            ? item.operationId
            : item?.status === 'completed'
              ? item.dealId
              : 'not-eligible',
        ),
      ).size,
    ).toBe(1);
    expect(deal).toMatchObject({ assignedTo: '1', amount: null, conversionStatus: 'pending' });
    expect(cursor.position).toBe('1');
    const createdDeal = crmStore.calls.findLast(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    );
    expect(createdDeal?.payload.fields).toMatchObject({
      leadId: (
        await infrastructure.database.dataSource
          .getRepository(LeadEntity)
          .findOneByOrFail({ id: leadId })
      ).bitrixLeadId,
      categoryId: 1,
      stageId: 'C1:NEW',
      assignedById: '1',
      probability: 10,
      UF_CRM_TIKTOK_EXTERNAL_ID: `aasc-tiktok/deal/${deal.id}`,
    });
    expect(
      crmStore.calls.filter(
        (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
      ),
    ).toHaveLength(dealCreatesBefore + 1);
    expect(
      await infrastructure.database.dataSource
        .getRepository(OperationEntity)
        .count({ where: { kind: OPERATION_KINDS.bitrixDealConvert } }),
    ).toBe(1);
  });

  it('rejects an invalid pipeline or inactive selected assignee without creating a remote deal', async () => {
    const leadId = await saveLead();
    const dealCreatesBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    ).length;
    await storeRules({ manual_conversion: { ...rules().manual_conversion, stage_id: 'UNKNOWN' } });
    await expect(conversions.request(leadId, 'manual')).rejects.toThrow(
      'stage is no longer available',
    );
    expect(
      crmStore.calls.filter(
        (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
      ),
    ).toHaveLength(dealCreatesBefore);

    await storeRules({
      manual_conversion: { ...rules().manual_conversion, fallback_sales_id: 'inactive' },
      assignment: {
        ...rules().assignment,
        strategy: 'fallback',
        fallback_sales_id: 'inactive',
        sales_ids: ['inactive'],
      },
    });
    await expect(conversions.request(leadId, 'manual')).rejects.toThrow('not active');
    expect(
      crmStore.calls.filter(
        (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
      ),
    ).toHaveLength(dealCreatesBefore);
  });

  it('links one pre-existing remote deal by Lead and quarantines multiple remote deals', async () => {
    const leadId = await saveLead();
    const lead = await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .findOneByOrFail({ id: leadId });
    const first = await gateway.createDeal(
      { title: 'Existing', leadId: lead.bitrixLeadId, categoryId: 1, stageId: 'C1:NEW' },
      'external-deal',
    );
    const dealCreatesBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    ).length;
    const receipt = await conversions.request(leadId, 'manual');
    if (!receipt || receipt.status !== 'pending') throw new Error('expected a pending conversion');
    await expect(conversions.execute(receipt.operationId, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    await expect(
      infrastructure.database.dataSource.getRepository(DealEntity).findOneByOrFail({ leadId }),
    ).resolves.toMatchObject({ bitrixDealId: first.id, conversionStatus: 'completed' });
    expect(
      crmStore.calls.filter(
        (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
      ),
    ).toHaveLength(dealCreatesBefore);

    const secondLeadId = await saveLead();
    const secondLead = await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .findOneByOrFail({ id: secondLeadId });
    await gateway.createDeal(
      { title: 'Existing A', leadId: secondLead.bitrixLeadId },
      'external-a',
    );
    await gateway.createDeal(
      { title: 'Existing B', leadId: secondLead.bitrixLeadId },
      'external-b',
    );
    const multipleDealCreatesBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    ).length;
    const secondReceipt = await conversions.request(secondLeadId, 'manual');
    if (!secondReceipt || secondReceipt.status !== 'pending')
      throw new Error('expected a pending conversion');
    await expect(conversions.execute(secondReceipt.operationId, context())).resolves.toMatchObject({
      outcome: 'quarantined',
      errorCode: 'LEAD_HAS_MULTIPLE_DEALS',
    });
    expect(
      crmStore.calls.filter(
        (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
      ),
    ).toHaveLength(multipleDealCreatesBefore);
  });

  it('retries Lead completion without creating a second deal and preserves the assignment snapshot', async () => {
    const leadId = await saveLead();
    const receipt = await conversions.request(leadId, 'manual');
    if (!receipt || receipt.status !== 'pending') throw new Error('expected a pending conversion');
    const saved = await infrastructure.database.dataSource
      .getRepository(DealEntity)
      .findOneByOrFail({ id: receipt.dealId });
    const createsBefore = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    ).length;
    const completionCallsBefore = crmStore.calls.filter(
      (call) =>
        call.method === 'crm.item.update' &&
        (call.payload.fields as Record<string, unknown> | undefined)?.statusId === 'CONVERTED',
    ).length;
    crmStore.injectFault('crm.item.update', 'rate_limit');
    await expect(conversions.execute(receipt.operationId, context())).resolves.toMatchObject({
      outcome: 'retry_wait',
    });
    await expect(conversions.execute(receipt.operationId, context())).resolves.toMatchObject({
      outcome: 'succeeded',
    });
    const remoteCreates = crmStore.calls.filter(
      (call) => call.method === 'crm.item.add' && call.payload.entityTypeId === 2,
    );
    expect(remoteCreates).toHaveLength(createsBefore + 1);
    expect(
      crmStore.calls.filter(
        (call) =>
          call.method === 'crm.item.update' &&
          (call.payload.fields as Record<string, unknown> | undefined)?.statusId === 'CONVERTED',
      ).length,
    ).toBe(completionCallsBefore + 2);
    await expect(
      infrastructure.database.dataSource
        .getRepository(DealEntity)
        .findOneByOrFail({ id: receipt.dealId }),
    ).resolves.toMatchObject({
      assignedTo: saved.assignedTo,
      ruleRevision: saved.ruleRevision,
      bitrixDealId: expect.any(String),
      conversionStatus: 'completed',
    });
    expect(
      await infrastructure.database.dataSource
        .getRepository(LeadEntity)
        .findOneByOrFail({ id: leadId }),
    ).toMatchObject({
      businessStatus: 'converted',
      dealCreatedAt: expect.any(Date),
      convertedAt: expect.any(Date),
    });
  });

  async function saveLead(): Promise<string> {
    const id = randomUUID();
    const remote = await gateway.createLead(
      { title: `Lead ${id}`, name: `Lead ${id}` },
      `aasc-tiktok/${id}`,
    );
    const submissionId = randomUUID();
    const eventId = randomUUID();
    const dataSource = infrastructure.database.dataSource;
    const payload = { lead_data: { full_name: `Lead ${id}` } };
    await dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'conversion-test',
      advertiserId: 'conversion-test',
      portalKey: null,
      eventKey: `event-${id}`,
      eventType: 'lead.generate',
      occurredAt: new Date(),
      receivedAt: new Date(),
      rawBody: Buffer.from(JSON.stringify(payload)),
      payload,
      payloadHash: 'a'.repeat(64),
      status: 'processed',
      errorCode: null,
    });
    await dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `external-${id}`,
      advertiserId: 'conversion-test',
      scopeKey: 'conversion-test',
      portalKey: 'conversion-portal',
      providerMode: 'mock',
      name: `Lead ${id}`,
      email: null,
      phone: null,
      city: 'Hanoi',
      interests: [],
      score: 0,
      scoreVersion: 1,
      scoreBreakdown: {},
      businessStatus: 'new',
      syncStatus: 'synced',
      bitrixLeadId: remote.id,
      firstSubmissionId: null,
      lastSubmissionId: null,
      firstTouchAt: new Date(),
      firstTouchCampaignId: 'campaign-unmatched',
      lastTouchAt: new Date(),
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version: 1,
      lastErrorCode: null,
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      advertiserId: 'conversion-test',
      providerMode: 'mock',
      leadId: id,
      eventId,
      providerLeadId: null,
      submissionKey: `submission-${id}`,
      campaignId: null,
      campaignName: null,
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
    await storeRules();
    return id;
  }

  async function storeRules(overrides: Record<string, unknown> = {}): Promise<void> {
    const value = { ...rules(), ...overrides };
    configurationRevision += 1;
    await infrastructure.database.dataSource.getRepository(ConfigurationEntity).save({
      id: randomUUID(),
      key: 'rules',
      revision: configurationRevision,
      value: { config: value, compiled: null },
      createdBy: null,
    });
    await infrastructure.database.dataSource
      .getRepository(ConfigurationHeadEntity)
      .save({ key: 'rules', revision: configurationRevision });
  }

  function rules() {
    return {
      schema_version: 1,
      auto_conversion: { enabled: true },
      manual_conversion: {
        enabled: true,
        pipeline_id: 1,
        stage_id: 'C1:NEW',
        probability: 10,
        fallback_sales_id: '1',
      },
      stage_probabilities: [{ pipeline_id: 1, stage_id: 'C1:NEW', probability: 10 }],
      assignment: { strategy: 'round_robin' as const, fallback_sales_id: '1', sales_ids: ['1'] },
      quality_scoring: {
        weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
        interaction_window_days: 30,
        interaction_points: 5,
        interaction_cap: 4,
      },
      feedback: { enabled: false },
      reporting: { timezone: 'Asia/Ho_Chi_Minh' },
      alerts: { enabled: true },
      rules: [
        {
          id: 'always',
          priority: 1,
          enabled: true,
          conditions: { field: 'lead.source', op: 'eq', value: 'tiktok' },
          action: 'create_deal' as const,
          pipeline_id: 1,
          stage_id: 'C1:NEW',
          probability: 10,
          assignment: {},
        },
      ],
    };
  }

  function context(): OperationContext {
    const operationId = randomUUID();
    return {
      operationId,
      ownerToken: randomUUID(),
      attempt: 1,
      revisions: { rules: configurationRevision },
      signal: new AbortController().signal,
      assertOwnership: () => Promise.resolve(),
      acquireAggregateLease: (key) => leases.claim(key, 30_000),
      releaseAggregateLease: async (current) => leases.release(current),
    };
  }
});
