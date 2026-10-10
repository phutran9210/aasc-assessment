import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { TiktokAppModule } from '@/apps/tiktok/app.module.js';
import type { BitrixConfig } from '@config/bitrix.config.js';
import { BitrixAdapterModule } from '@modules/crm-integration/bitrix-adapter.module.js';
import { CrmIntegrationModule } from '@modules/crm-integration/crm-integration.module.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';

@Module({})
class ConfigurationTestModule {}

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
            portalKey: 'configuration-test-portal',
            namespace: `configuration-${randomUUID()}`,
            bitrix: bitrixConfig,
            limiter: { intervalMs: 1, maxWaitMs: 1000, cooldownMs: 1 },
          }),
        ],
      }),
    ],
  })(ConfigurationTestModule);
  return ConfigurationTestModule;
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
    assignment: { strategy: 'fallback', fallback_sales_id: '1', sales_ids: ['1'] },
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
        id: 'campaign-sale',
        priority: 1,
        enabled: true,
        conditions: { field: 'lead.campaign_name', op: 'contains', value: 'sale' },
        action: 'create_deal',
        pipeline_id: 1,
        stage_id: 'C1:NEW',
        probability: 10,
        assignment: { sales_id: '1' },
      },
    ],
  };
}

function mapping(title = 'NAME') {
  return {
    entries: [
      { source: title, target: 'name', owner: 'integration', transforms: ['trim'] },
      { source: 'EMAIL', target: 'fm', subfield: 'EMAIL', owner: 'integration' },
      { source: 'PHONE', target: 'fm', subfield: 'PHONE', owner: 'integration' },
      { source: 'company', target: 'UF_CRM_CITY', owner: 'manual' },
    ],
  };
}

describe('TikTok configuration ETag API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let server: ProviderServer;
  let crmStore: BitrixStore;
  let adminToken: string;
  let analystToken: string;

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
    await dataSource.getRepository(ConfigurationHeadEntity).delete({ key: 'mapping' });
    await dataSource.getRepository(ConfigurationHeadEntity).delete({ key: 'rules' });
    await dataSource.getRepository(ConfigurationEntity).delete({ key: 'mapping' });
    await dataSource.getRepository(ConfigurationEntity).delete({ key: 'rules' });
    await dataSource.getRepository(IntegrationUserEntity).clear();
    const bcrypt = await import('bcrypt');
    await dataSource.getRepository(IntegrationUserEntity).save([
      {
        id: randomUUID(),
        username: 'configuration-admin',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        roles: ['integration_admin'],
        active: true,
        authVersion: 1,
      },
      {
        id: randomUUID(),
        username: 'configuration-analyst',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        roles: ['integration_analyst'],
        active: true,
        authVersion: 1,
      },
    ]);
    const [admin, analyst] = await Promise.all([
      request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'configuration-admin', password: PASSWORD })
        .expect(200),
      request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'configuration-analyst', password: PASSWORD })
        .expect(200),
    ]);
    adminToken = admin.body.accessToken as string;
    analystToken = analyst.body.accessToken as string;
  });

  afterAll(async () => {
    await testApp.close();
    await server.close();
    await infrastructure.close();
  });

  it('requires an admin and If-Match, then returns the mapping revision and ETag', async () => {
    await request(testApp.app.getHttpServer())
      .get('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(403);
    const initial = await request(testApp.app.getHttpServer())
      .get('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(initial.headers.etag).toBe('"0"');
    expect(initial.body).toMatchObject({ key: 'mapping', revision: 0 });
    expect(initial.body.value.entries.map((entry: { source: string }) => entry.source)).toEqual([
      'name',
      'email',
      'phone',
    ]);
    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: mapping() })
      .expect(428);

    const response = await request(testApp.app.getHttpServer())
      .put('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: mapping() })
      .expect(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.body).toMatchObject({
      key: 'mapping',
      revision: 1,
      value: mapping(),
    });
    expect(response.body.compiled.entries[0]).toMatchObject({
      sourcePath: ['NAME'],
      target: 'name',
      transforms: ['trim'],
      owner: 'integration',
    });
    expect(response.body.compiled.titleMaxLength).toBe(180);
    await request(testApp.app.getHttpServer())
      .get('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ headers, body }) => {
        expect(headers.etag).toBe('"1"');
        expect(body.revision).toBe(1);
      });
  });

  it('allows only one concurrent PUT with the same revision and rejects stale ETags', async () => {
    const writes = await Promise.all([
      request(testApp.app.getHttpServer())
        .put('/api/v1/config/mappings')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', '"0"')
        .send({ value: mapping('NAME') }),
      request(testApp.app.getHttpServer())
        .put('/api/v1/config/mappings')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', '"0"')
        .send({ value: mapping('FIRST_NAME') }),
    ]);
    expect(writes.map((response) => response.status).sort()).toEqual([200, 409]);
    const active = await request(testApp.app.getHttpServer())
      .get('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(active.body.revision).toBe(1);

    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: mapping() })
      .expect(409);
  });

  it('does not advance the active revision when CRM metadata validation fails', async () => {
    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: mapping() })
      .expect(200);
    crmStore.injectFault('crm.item.fields', 'auth_invalid');
    const response = await request(testApp.app.getHttpServer())
      .put('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ value: mapping('FIRST_NAME') });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await request(testApp.app.getHttpServer())
      .get('/api/v1/config/mappings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.revision).toBe(1));
  });

  describe('configuration document of the assignment', () => {
    const assignment = {
      field_mapping: {
        'lead_data.full_name': 'NAME',
        'lead_data.email': 'EMAIL[0][VALUE]',
        'lead_data.phone': 'PHONE[0][VALUE]',
        'lead_data.city': 'UF_CRM_CITY',
        'campaign.campaign_name': 'UF_CRM_UTM_CAMPAIGN',
        'campaign.ad_name': 'UF_CRM_AD_NAME',
        'lead_data.ttclid': 'UF_CRM_TTCLID',
      },
      deal_rules: [
        {
          condition: "campaign.campaign_name CONTAINS 'sale'",
          action: 'create_deal',
          pipeline_id: '1',
          stage_id: 'NEW',
          probability: 30,
        },
      ],
    };
    const put = (path: string, etag: string, body: object) =>
      request(testApp.app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', etag)
        .send(body);
    const get = (path: string) =>
      request(testApp.app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

    it('is accepted as it is printed and becomes the mapping and the deal rules', async () => {
      await put('/api/v1/config/rules', '"0"', { value: rules() }).expect(200);

      const stored = await put('/api/v1/config/mappings', '"0"', assignment).expect(200);

      expect(stored.headers.etag).toBe('"1"');
      expect(stored.body.value.entries).toEqual(
        expect.arrayContaining([
          { source: 'name', target: 'name', owner: 'integration', transforms: [] },
          {
            source: 'email',
            target: 'fm',
            subfield: 'EMAIL',
            owner: 'integration',
            transforms: [],
          },
          { source: 'city', target: 'UF_CRM_CITY', owner: 'integration', transforms: [] },
          { source: 'ttclid', target: 'UF_CRM_TTCLID', owner: 'integration', transforms: [] },
        ]),
      );
      const policy = await get('/api/v1/config/rules').expect(200);
      expect(policy.headers.etag).toBe('"2"');
      expect(policy.body.value.rules).toEqual([
        {
          id: 'deal-rule-1',
          priority: 10,
          enabled: true,
          conditions: { field: 'lead.campaign_name', op: 'contains', value: 'sale' },
          action: 'create_deal',
          pipeline_id: 1,
          stage_id: 'C1:NEW',
          probability: 30,
          assignment: {},
        },
      ]);
      // Sections the assignment's format cannot express are kept.
      expect(policy.body.value.assignment).toEqual(rules().assignment);
    });

    it('accepts the deal rules on the rules endpoint too', async () => {
      await put('/api/v1/config/rules', '"0"', { value: rules() }).expect(200);

      const stored = await put('/api/v1/config/rules', '"1"', {
        deal_rules: assignment.deal_rules,
      }).expect(200);

      expect(stored.headers.etag).toBe('"2"');
      expect(stored.body.value.rules).toHaveLength(1);
      expect(stored.body.value.rules[0]).toMatchObject({ id: 'deal-rule-1', stage_id: 'C1:NEW' });
    });

    it('writes nothing when one half of the document is invalid', async () => {
      await put('/api/v1/config/rules', '"0"', { value: rules() }).expect(200);

      await put('/api/v1/config/mappings', '"0"', {
        ...assignment,
        deal_rules: [{ ...assignment.deal_rules[0], stage_id: 'MISSING' }],
      }).expect(400);
      await put('/api/v1/config/mappings', '"0"', {
        ...assignment,
        field_mapping: { 'lead_data.full_name': 'UF_CRM_DOES_NOT_EXIST' },
      }).expect(400);

      expect((await get('/api/v1/config/mappings').expect(200)).headers.etag).toBe('"0"');
      expect((await get('/api/v1/config/rules').expect(200)).headers.etag).toBe('"1"');
    });

    it('asks for a rules policy before deal rules can extend it', async () => {
      await put('/api/v1/config/mappings', '"0"', assignment).expect(400);
      await put('/api/v1/config/mappings', '"0"', {
        field_mapping: assignment.field_mapping,
      }).expect(200);
    });
  });

  it('stores canonical rules only after pipeline, stage, probability, and active sales validation', async () => {
    const response = await request(testApp.app.getHttpServer())
      .put('/api/v1/config/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: rules() })
      .expect(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.body.value).toEqual(rules());
    const read = await request(testApp.app.getHttpServer())
      .get('/api/v1/config/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(read.headers.etag).toBe('"1"');
    expect(read.body.value.manual_conversion.stage_id).toBe('C1:NEW');

    const invalidPipeline = rules();
    invalidPipeline.rules[0].pipeline_id = 0;
    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ value: invalidPipeline })
      .expect(400);
    const invalidProbability = rules();
    invalidProbability.rules[0].probability = 101;
    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ value: invalidProbability })
      .expect(400);
    const inactiveSales = rules();
    inactiveSales.assignment.sales_ids = ['999'];
    await request(testApp.app.getHttpServer())
      .put('/api/v1/config/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ value: inactiveSales })
      .expect(400);
  });
});
