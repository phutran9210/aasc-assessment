import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { TiktokAppModule } from '../../src/apps/tiktok/app.module.js';
import type { BitrixConfig } from '../../src/config/bitrix.config.js';
import { BitrixAdapterModule } from '../../src/modules/crm-integration/bitrix-adapter.module.js';
import { CrmIntegrationModule } from '../../src/modules/crm-integration/crm-integration.module.js';
import { ConfigurationEntity } from '../../src/modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '../../src/modules/crm-integration/entities/configuration-head.entity.js';
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

function mapping(title = 'NAME') {
  return {
    entries: [
      { source: title, target: 'name', owner: 'integration', transforms: ['trim'] },
      { source: 'EMAIL', target: 'fm', subfield: 'EMAIL', owner: 'integration' },
      { source: 'PHONE', target: 'fm', subfield: 'PHONE', owner: 'integration' },
      { source: 'company', target: 'UF_CRM_TIKTOK_EXTERNAL_ID', owner: 'manual' },
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
    await dataSource.getRepository(ConfigurationEntity).delete({ key: 'mapping' });
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
        .post('/auth/login')
        .send({ username: 'configuration-admin', password: PASSWORD })
        .expect(200),
      request(testApp.app.getHttpServer())
        .post('/auth/login')
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
      .get('/configuration/mapping')
      .set('Authorization', `Bearer ${analystToken}`)
      .expect(403);
    await request(testApp.app.getHttpServer())
      .get('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await request(testApp.app.getHttpServer())
      .put('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: mapping() })
      .expect(428);

    const response = await request(testApp.app.getHttpServer())
      .put('/configuration/mapping')
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
    await request(testApp.app.getHttpServer())
      .get('/configuration/mapping')
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
        .put('/configuration/mapping')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', '"0"')
        .send({ value: mapping('NAME') }),
      request(testApp.app.getHttpServer())
        .put('/configuration/mapping')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', '"0"')
        .send({ value: mapping('FIRST_NAME') }),
    ]);
    expect(writes.map((response) => response.status).sort()).toEqual([200, 409]);
    const active = await request(testApp.app.getHttpServer())
      .get('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(active.body.revision).toBe(1);

    await request(testApp.app.getHttpServer())
      .put('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: mapping() })
      .expect(409);
  });

  it('does not advance the active revision when CRM metadata validation fails', async () => {
    await request(testApp.app.getHttpServer())
      .put('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"0"')
      .send({ value: mapping() })
      .expect(200);
    crmStore.injectFault('crm.item.fields', 'auth_invalid');
    const response = await request(testApp.app.getHttpServer())
      .put('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ value: mapping('FIRST_NAME') });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await request(testApp.app.getHttpServer())
      .get('/configuration/mapping')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.revision).toBe(1));
  });
});
