import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { runDemo } from '@/apps/tiktok/cli/demo-flow.js';
import type { DemoSummary } from '@/apps/tiktok/cli/demo-flow.js';
import {
  DEMO_FIELD_MAPPING,
  DEMO_PASSWORD,
  DEMO_RULES,
  seedDemo,
} from '@/apps/tiktok/database/seed.js';
import { assertDeploymentIdentity } from '@/apps/tiktok/deployment-identity.js';
import { buildOpenApiDocument } from '@/apps/tiktok/openapi.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { importAssignmentConfig } from '@modules/crm-integration/domain/assignment-config-import.js';
import { parseWebhookEnvelope } from '@modules/tiktok/domain/webhook-envelope.js';
import { rulesSchema } from '@modules/crm-integration/schemas/rules.schema.js';
import { mappingSchema } from '@modules/crm-integration/schemas/mapping.schema.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const ADVERTISER = 'mock-advertiser';
const WEBHOOK_SECRET = 'demo-webhook-secret-for-the-e2e-run';
const BITRIX_EVENT_SECRET = 'demo-bitrix-event-secret-e2e';

describe('reproducible demo', () => {
  let infrastructure: TestInfrastructure;
  let mock: ProviderServer;
  let artifactDir: string;
  let api: TestApp;
  let worker: INestApplicationContext;
  let dataSource: DataSource;
  let baseUrl: string;
  let summary: DemoSummary;
  const previousEnv = new Map<string, string | undefined>();

  function setEnv(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
  }

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    artifactDir = await mkdtemp(join(tmpdir(), 'aasc-demo-'));
    mock = new ProviderServer({ bitrix: new BitrixStore(), tiktok: new TiktokStore() });
    await mock.listen();
    setEnv({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
      INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      INTEGRATION_ARTIFACT_DIR: artifactDir,
      TIKTOK_MODE: 'mock',
      BITRIX_INTEGRATION_MODE: 'mock',
      TIKTOK_ADVERTISER_ID: ADVERTISER,
      TIKTOK_WEBHOOK_SECRET: WEBHOOK_SECRET,
      BITRIX_MOCK_EVENT_SECRET: BITRIX_EVENT_SECRET,
      BITRIX_PORTAL_KEY: 'mock-portal',
      TIKTOK_BITRIX24_WEBHOOK_URL: mock.bitrixEndpoint,
      TIKTOK_MOCK_BASE_URL: mock.tiktokBaseUrl,
      TIKTOK_MOCK_API_KEY: 'mock-api-key',
    });
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
    await mock.close();
    await infrastructure.close();
    await rm(artifactDir, { recursive: true, force: true });
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('seed', () => {
    const counts = async () => ({
      users: await infrastructure.database.dataSource.getRepository(IntegrationUserEntity).count(),
      configurations: await infrastructure.database.dataSource
        .getRepository(ConfigurationEntity)
        .count(),
      costs: await infrastructure.database.dataSource.getRepository(CampaignDailyEntity).count(),
    });

    it('creates the demo identity, users, rules and costs, and is repeatable', async () => {
      const config = validateTiktokEnv(process.env);

      const first = await seedDemo(infrastructure.database.dataSource, config);
      const afterFirst = await counts();
      const second = await seedDemo(infrastructure.database.dataSource, config);

      expect(first).toMatchObject({ identity: 'claimed', users: 3, rulesRevision: 1 });
      expect(second).toMatchObject({ identity: 'verified', users: 3, rulesRevision: 1 });
      expect(first.campaignCostRows).toBeGreaterThan(0);
      expect(second.campaignCostRows).toBe(first.campaignCostRows);
      expect(await counts()).toEqual(afterFirst);
      expect(afterFirst).toMatchObject({ users: 3, configurations: 2 });
    });

    it('refuses demo credentials in production or outside mock mode', async () => {
      const config = validateTiktokEnv(process.env);
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      await expect(seedDemo(infrastructure.database.dataSource, config)).rejects.toThrow(/demo/i);
      process.env.NODE_ENV = previous;

      await expect(
        seedDemo(infrastructure.database.dataSource, { ...config, bitrixMode: 'real' }),
      ).rejects.toThrow(/mock/i);
      await expect(
        seedDemo(infrastructure.database.dataSource, { ...config, tiktokMode: 'business-api' }),
      ).rejects.toThrow(/mock/i);
    });

    it('rejects a start-up whose advertiser, portal or mode differs from the stored identity', async () => {
      const config = validateTiktokEnv(process.env);
      const dataSource = infrastructure.database.dataSource;

      await expect(assertDeploymentIdentity(dataSource, config)).resolves.toBe('verified');
      for (const changed of [
        { advertiserId: 'another-advertiser' },
        { portalKey: 'another-portal' },
        { bitrixMode: 'real' as const },
        { tiktokMode: 'business-api' as const },
      ]) {
        await expect(
          assertDeploymentIdentity(dataSource, { ...config, ...changed }),
        ).rejects.toThrow(/deployment identity/i);
      }
    });

    it('creates an audited account from the admin tool and rejects weak input', async () => {
      const { createIntegrationUser } =
        await import('@modules/integration-auth/cli/create-integration-user.js');
      const { AuditEventEntity } =
        await import('@modules/crm-integration/entities/audit-event.entity.js');
      const dataSource = infrastructure.database.dataSource;
      const username = `ops-${Date.now()}`;

      const created = await createIntegrationUser(dataSource, {
        username,
        roles: ['integration_operator', 'integration_operator'],
        password: 'a-long-unique-passphrase-42',
      });

      expect(created).toMatchObject({ username, roles: ['integration_operator'] });
      expect(
        await dataSource.getRepository(AuditEventEntity).findOneBy({ aggregateId: created.id }),
      ).toMatchObject({ eventType: 'user.created', metadata: { username, source: 'cli' } });
      for (const bad of [
        { username, roles: ['integration_operator'], password: 'a-long-unique-passphrase-42' },
        { username: 'ops-2', roles: ['integration_operator'], password: DEMO_PASSWORD },
        { username: 'ops-3', roles: ['integration_operator'], password: 'short' },
        { username: 'ops-4', roles: ['root'], password: 'a-long-unique-passphrase-42' },
        { username: 'x', roles: ['integration_admin'], password: 'a-long-unique-passphrase-42' },
        { username: 'ops-5', roles: ['integration_admin'], password: 'ops-5-is-my-password' },
      ]) {
        await expect(createIntegrationUser(dataSource, bad)).rejects.toThrow();
      }
      await dataSource.getRepository(IntegrationUserEntity).delete({ username });
    });

    it('ships sample configuration files that match the seeded policy and the schemas', async () => {
      const rules = JSON.parse(await readFile('samples/tiktok/rules.json', 'utf8')) as unknown;
      const mapping = JSON.parse(await readFile('samples/tiktok/mapping.json', 'utf8')) as unknown;

      expect(rules).toEqual(DEMO_RULES);
      expect(rulesSchema.safeParse(rules).success).toBe(true);
      expect(mappingSchema.safeParse(mapping).success).toBe(true);
    });

    it('ships the documents of the assignment, and they import to that same configuration', async () => {
      const read = async (name: string) =>
        JSON.parse(await readFile(`samples/tiktok/${name}`, 'utf8')) as Record<string, unknown>;
      const assignment = await read('assignment-config.json');

      const imported = importAssignmentConfig(assignment, [
        { id: 'C1:NEW', name: 'Pipeline new', categoryId: 1, semantic: null },
      ]);

      expect(assignment.field_mapping).toEqual(DEMO_FIELD_MAPPING);
      expect(imported.mapping).toEqual(await read('mapping.json'));
      expect(imported.rules).toEqual(DEMO_RULES.rules);
      expect(parseWebhookEnvelope(await read('lead-generate.json'))).toMatchObject({
        eventId: 'evt_1234567890',
        eventType: 'lead.generate',
        advertiserId: '7123456789',
      });
    });
  });

  describe('end-to-end flow', () => {
    beforeAll(async () => {
      const { TiktokApiModule } = await import('@/apps/tiktok/api.module.js');
      api = await createTestApp({}, TiktokApiModule.fromEnvironment());
      await api.app.listen(0, '127.0.0.1');
      baseUrl = `http://127.0.0.1:${(api.app.getHttpServer().address() as AddressInfo).port}`;
      dataSource = api.app.get<DataSource>(getDataSourceToken('tiktok'));
      const { TiktokWorkerModule } = await import('@/apps/tiktok/worker.module.js');
      worker = await NestFactory.createApplicationContext(TiktokWorkerModule, { logger: false });

      summary = await runDemo({
        apiBaseUrl: baseUrl,
        bitrixRestUrl: mock.bitrixEndpoint,
        advertiserId: ADVERTISER,
        portalKey: 'mock-portal',
        webhookSecret: WEBHOOK_SECRET,
        bitrixEventSecret: BITRIX_EVENT_SECRET,
        username: 'demo-admin',
        password: DEMO_PASSWORD,
        timeoutMs: 45_000,
      });
    }, 90_000);

    it('turns one signed webhook into one lead, one deal and a won deal', () => {
      expect(summary).toMatchObject({
        health: 'ok',
        lead: { syncStatus: 'synced', bitrixLeadId: expect.any(String) },
        deal: {
          stageSemantics: 'won',
          conversionStatus: 'completed',
          bitrixDealId: expect.any(String),
        },
      });
    });

    it('reports the conversion in analytics', () => {
      expect(summary.analytics).toMatchObject({
        leads: 1,
        convertedLeads: 1,
        wonLeads: 1,
        leadToDealRate: '100',
        leadToWonRate: '100',
      });
      expect(summary.campaign).toMatchObject({
        campaignId: 'campaign-spring-2024',
        leads: 1,
        wonLeads: 1,
      });
    });

    it('exports the lead as CSV, JSON and XLSX', () => {
      expect(summary.exports).toMatchObject({ json: { rows: 1 } });
      expect(summary.exports.csv.bytes).toBeGreaterThan(100);
      expect(summary.exports.xlsx.bytes).toBeGreaterThan(1_000);
    });

    it('keeps the application healthy with exactly one lead and one deal', async () => {
      const health = await request(baseUrl).get('/health').expect(200);
      expect(health.body).toMatchObject({ status: 'ok' });

      const login = await request(baseUrl)
        .post('/api/v1/auth/login')
        .send({ username: 'demo-analyst', password: DEMO_PASSWORD })
        .expect(200);
      const authorization = { Authorization: `Bearer ${login.body.accessToken as string}` };
      expect(
        (await request(baseUrl).get('/api/v1/leads').set(authorization).expect(200)).body,
      ).toMatchObject({ total: 1 });
      expect(
        (await request(baseUrl).get('/api/v1/deals').set(authorization).expect(200)).body,
      ).toMatchObject({ total: 1 });
      expect(await dataSource.getRepository(IntegrationUserEntity).count()).toBe(3);
    });

    it('describes every route in an OpenAPI document without leaking configuration', () => {
      const document = buildOpenApiDocument(api.app);
      const text = JSON.stringify(document);

      for (const path of [
        '/webhooks/tiktok/leads',
        '/api/v1/leads',
        '/api/v1/leads/{id}/convert-to-deal',
        '/api/v1/analytics/conversion-rates',
        '/api/v1/analytics/campaign-performance',
        '/api/v1/reports/export',
        '/api/v1/leads/imports',
        '/api/v1/notifications',
        '/health/ready',
      ]) {
        expect(document.paths[path]).toBeDefined();
      }
      expect(document.paths['/api/v1/leads']?.get?.security).toEqual([{ bearer: [] }]);
      expect(document.paths['/api/v1/leads']?.get?.responses).toEqual(
        expect.objectContaining({
          '401': expect.anything(),
          '403': expect.anything(),
          '429': expect.anything(),
        }),
      );
      expect(document.paths['/webhooks/tiktok/leads']?.post?.security).toEqual([]);
      expect(document.paths['/health/live']?.get?.security).toEqual([]);
      for (const secret of [
        WEBHOOK_SECRET,
        BITRIX_EVENT_SECRET,
        DEMO_PASSWORD,
        process.env.TIKTOK_JWT_SECRET as string,
        'tiktok_test_only',
        'rawBody',
        'passwordHash',
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
