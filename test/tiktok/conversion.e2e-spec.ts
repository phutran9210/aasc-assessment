import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { TiktokAppModule } from '../../src/apps/tiktok/app.module.js';
import type { BitrixConfig } from '../../src/config/bitrix.config.js';
import { BitrixAdapterModule } from '../../src/modules/crm-integration/bitrix-adapter.module.js';
import { CrmIntegrationModule } from '../../src/modules/crm-integration/crm-integration.module.js';
import { CRM_GATEWAY } from '../../src/modules/crm-integration/ports/crm-gateway.port.js';
import type { CrmGateway } from '../../src/modules/crm-integration/ports/crm-gateway.port.js';
import { ConfigurationEntity } from '../../src/modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '../../src/modules/crm-integration/entities/configuration-head.entity.js';
import { LeadEntity } from '../../src/modules/crm-integration/entities/lead.entity.js';
import { ConversionService } from '../../src/modules/crm-integration/services/conversion.service.js';
import type { OperationContext } from '../../src/core/queue/types/worker.types.js';
import { IntegrationUserEntity } from '../../src/modules/integration-auth/entities/integration-user.entity.js';
import { BitrixStore } from '../../src/modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '../../src/modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '../../src/modules/tiktok/testing/tiktok-store.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';

@Module({})
class ConversionTestModule {}

function buildRootModule(endpoint: string): Type<unknown> {
  const bitrixConfig: BitrixConfig = {
    clientId: '',
    clientSecret: '',
    portalDomain: '',
    requisitePresetId: 1,
    webhookUrl: endpoint,
    timeoutMs: 200,
    stateTtlSeconds: 600,
    refreshSkewSeconds: 60,
  };
  Module({
    imports: [
      TiktokAppModule,
      CrmIntegrationModule.register({
        imports: [
          BitrixAdapterModule.register({
            portalKey: 'conversion-e2e-portal',
            namespace: `conversion-e2e-${randomUUID()}`,
            bitrix: bitrixConfig,
            limiter: { intervalMs: 1, maxWaitMs: 1000, cooldownMs: 1 },
          }),
        ],
      }),
    ],
  })(ConversionTestModule);
  return ConversionTestModule;
}

describe('Lead conversion API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let server: ProviderServer;
  let crmStore: BitrixStore;
  let operatorToken: string;
  let configRevision = 0;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    crmStore = new BitrixStore();
    server = new ProviderServer({ bitrix: crmStore, tiktok: new TiktokStore() });
    await server.listen();
    testApp = await createTestApp(
      {
        TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
        TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
        TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
        INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      },
      buildRootModule(server.bitrixEndpoint),
    );
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
  });

  beforeEach(async () => {
    configRevision =
      (await dataSource.getRepository(ConfigurationHeadEntity).findOneBy({ key: 'rules' }))
        ?.revision ?? 0;
    await dataSource.getRepository(IntegrationUserEntity).clear();
    const bcrypt = await import('bcrypt');
    await dataSource.getRepository(IntegrationUserEntity).save({
      id: randomUUID(),
      username: 'conversion-operator',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roles: ['integration_operator'],
      active: true,
      authVersion: 1,
    });
    const login = await request(testApp.app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'conversion-operator',
        password: PASSWORD,
      })
      .expect(200);
    operatorToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await testApp.close();
    await server.close();
    await infrastructure.close();
  });

  it('returns 202 with the durable operation when an operator requests conversion', async () => {
    const leadId = await saveSyncedLead();
    await storeRules();
    const response = await request(testApp.app.getHttpServer())
      .post(`/api/v1/leads/${leadId}/convert-to-deal`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .set('Idempotency-Key', `convert-${leadId}`)
      .expect(202);

    expect(response.body).toMatchObject({
      status: 'pending',
      operationId: expect.any(String),
      dealId: expect.any(String),
    });
  });

  it('returns 200 with the remote deal when the conversion saga is already complete', async () => {
    const leadId = await saveSyncedLead();
    await storeRules();
    const path = `/api/v1/leads/${leadId}/convert-to-deal`;
    const accepted = await request(testApp.app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(202);
    await testApp.app
      .get<ConversionService>(ConversionService)
      .execute(accepted.body.operationId as string, context());

    await request(testApp.app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: 'completed', dealId: accepted.body.dealId });
        expect(body.bitrixDealId).toEqual(expect.any(String));
      });
  });

  it('returns 404 for an unknown lead and 409 when conversion policy is invalid', async () => {
    await storeRules();
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/leads/${uuidv7()}/convert-to-deal`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(404);

    const leadId = await saveSyncedLead();
    await storeRules({ manual_conversion: { ...rules().manual_conversion, enabled: false } });
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/leads/${leadId}/convert-to-deal`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(409);
  });

  async function saveSyncedLead(): Promise<string> {
    const id = uuidv7();
    const gateway = testApp.app.get<CrmGateway>(CRM_GATEWAY);
    const remote = await gateway.createLead(
      { title: `Lead ${id}`, name: `Lead ${id}` },
      `aasc-tiktok/${id}`,
    );
    await dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `external-${id}`,
      advertiserId: 'conversion-e2e',
      scopeKey: 'conversion-e2e',
      portalKey: 'conversion-e2e-portal',
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
      firstTouchCampaignId: null,
      lastTouchAt: null,
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version: 1,
      lastErrorCode: null,
    });
    return id;
  }

  function context(): OperationContext {
    return {
      operationId: randomUUID(),
      ownerToken: randomUUID(),
      attempt: 1,
      revisions: { mapping: 0, rules: configRevision, scoring: 0 },
      signal: new AbortController().signal,
      assertOwnership: () => Promise.resolve(),
      acquireAggregateLease: (key) =>
        Promise.resolve({
          key,
          ownerToken: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      releaseAggregateLease: () => Promise.resolve(true),
    };
  }

  async function storeRules(overrides: Record<string, unknown> = {}): Promise<void> {
    configRevision += 1;
    await dataSource.getRepository(ConfigurationEntity).save({
      id: randomUUID(),
      key: 'rules',
      revision: configRevision,
      value: { config: { ...rules(), ...overrides }, compiled: null },
      createdBy: null,
    });
    await dataSource
      .getRepository(ConfigurationHeadEntity)
      .save({ key: 'rules', revision: configRevision });
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
      assignment: { strategy: 'fallback' as const, fallback_sales_id: '1', sales_ids: ['1'] },
      quality_scoring: {
        weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
        interaction_window_days: 30,
        interaction_points: 5,
        interaction_cap: 4,
      },
      feedback: { enabled: false },
      reporting: { timezone: 'Asia/Ho_Chi_Minh' },
      alerts: { enabled: true },
      rules: [],
    };
  }
});
