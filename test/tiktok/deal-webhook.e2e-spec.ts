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
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const MOCK_SECRET = 'mock-bitrix-event-secret-for-tests';

@Module({})
class DealWebhookTestModule {}

function buildModule(): Type<unknown> {
  const bitrix: BitrixConfig = {
    clientId: '',
    clientSecret: '',
    portalDomain: '',
    requisitePresetId: 1,
    webhookUrl: 'https://mock-bitrix.example.test/rest/',
    timeoutMs: 100,
    stateTtlSeconds: 60,
    refreshSkewSeconds: 60,
  };
  Module({
    imports: [
      TiktokAppModule,
      CrmIntegrationModule.register({
        imports: [
          BitrixAdapterModule.register({
            portalKey: 'mock-portal',
            namespace: `deal-webhook-${randomUUID()}`,
            bitrix,
          }),
        ],
      }),
    ],
  })(DealWebhookTestModule);
  return DealWebhookTestModule;
}

describe('Bitrix deal callback endpoint', () => {
  let infrastructure: TestInfrastructure;
  let app: TestApp;
  let database: DataSource;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    app = await createTestApp(
      {
        TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
        TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
        TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
        INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
        BITRIX_INTEGRATION_MODE: 'mock',
        BITRIX_PORTAL_KEY: 'mock-portal',
        BITRIX_MOCK_EVENT_SECRET: MOCK_SECRET,
      },
      buildModule(),
    );
    database = app.app.get<DataSource>(getDataSourceToken('tiktok'));
  });

  beforeEach(async () => {
    await database.getRepository(OutboxEntity).createQueryBuilder().delete().execute();
    await database.getRepository(OperationEntity).createQueryBuilder().delete().execute();
    await database.getRepository(WebhookEventEntity).createQueryBuilder().delete().execute();
  });

  afterAll(async () => {
    await app?.close();
    await infrastructure?.close();
  });

  it('rejects a wrong mock secret and ACKs an authenticated event only after durable inbox/outbox commit', async () => {
    const body = {
      event_id: 'deal-event-1',
      event: 'deal.update',
      portal_key: 'mock-portal',
      deal_id: '42',
      timestamp: '2026-10-08T12:00:00.000Z',
      fields: { stageId: 'forged-stage' },
    };
    await request(app.app.getHttpServer())
      .post('/webhooks/bitrix24/deals')
      .set('X-Mock-Bitrix-Secret', 'bad-secret')
      .send(body)
      .expect(401);
    expect(await database.getRepository(WebhookEventEntity).count()).toBe(0);

    await request(app.app.getHttpServer())
      .post('/webhooks/bitrix24/deals')
      .set('X-Mock-Bitrix-Secret', MOCK_SECRET)
      .send(body)
      .expect(200)
      .expect(({ body: receipt }) => expect(receipt).toMatchObject({ duplicate: false }));
    expect(await database.getRepository(WebhookEventEntity).count()).toBe(1);
    expect(await database.getRepository(OperationEntity).count()).toBe(1);
    expect(await database.getRepository(OutboxEntity).count()).toBe(1);
    const stored = await database
      .getRepository(WebhookEventEntity)
      .findOneByOrFail({ eventKey: 'deal-event-1' });
    expect(stored.rawBody.toString()).not.toContain(MOCK_SECRET);
    expect(stored.payload).not.toHaveProperty('fields');

    await request(app.app.getHttpServer())
      .post('/webhooks/bitrix24/deals')
      .set('X-Mock-Bitrix-Secret', MOCK_SECRET)
      .send(body)
      .expect(200)
      .expect(({ body: receipt }) => expect(receipt).toMatchObject({ duplicate: true }));
    expect(await database.getRepository(WebhookEventEntity).count()).toBe(1);
    expect(await database.getRepository(OperationEntity).count()).toBe(1);
    expect(await database.getRepository(OutboxEntity).count()).toBe(1);
  });

  it('returns 400 for malformed callback envelopes before storing them', async () => {
    await request(app.app.getHttpServer())
      .post('/webhooks/bitrix24/deals')
      .set('X-Mock-Bitrix-Secret', MOCK_SECRET)
      .send({ event: 'ONCRMDEALUPDATE', data: { FIELDS: { ID: '0' } }, ts: 'invalid' })
      .expect(400);
    expect(await database.getRepository(WebhookEventEntity).count()).toBe(0);
  });

  it('rejects mock credential headers when the application runs in real mode', async () => {
    process.env.BITRIX_INTEGRATION_MODE = 'real';
    try {
      await request(app.app.getHttpServer())
        .post('/webhooks/bitrix24/deals')
        .set('X-Mock-Bitrix-Secret', MOCK_SECRET)
        .send({
          event_id: 'deal-event-real-mode',
          event: 'deal.update',
          portal_key: 'mock-portal',
          deal_id: '42',
          timestamp: '2026-10-08T12:00:00.000Z',
        })
        .expect(401);
    } finally {
      process.env.BITRIX_INTEGRATION_MODE = 'mock';
    }
  });
});
