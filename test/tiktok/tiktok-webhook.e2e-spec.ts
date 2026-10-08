import { createHmac } from 'node:crypto';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';
import { WebhookEventEntity } from '../../src/core/queue/entities/webhook-event.entity.js';
import { OperationEntity } from '../../src/core/queue/entities/operation.entity.js';
import { OutboxEntity } from '../../src/core/queue/entities/outbox.entity.js';
import { REDIS_CONNECTION_FACTORY } from '../../src/config/tiktok-app/redis.config.js';
import type { RedisConnectionFactory } from '../../src/core/queue/redis-connection.js';

const ADVERTISER = 'webhook-advertiser-test';
const SECRET = 'webhook-test-secret-minimum-length';

function leadEvent(eventId = 'event-1'): Record<string, unknown> {
  return {
    event_id: eventId,
    event: 'lead.generate',
    advertiser_id: ADVERTISER,
    timestamp: '2024-03-01T10:15:00.000Z',
    campaign_id: 'campaign-1',
    form_id: 'form-1',
    lead_data: { name: 'An Nguyễn', email: 'an@example.test', custom_questions: [] },
  };
}

function signedRequest(app: TestApp, body: Buffer, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.`).update(body).digest('hex');
  return request(app.app.getHttpServer())
    .post('/webhooks/tiktok/leads')
    .set('Content-Type', 'application/json')
    .set('TikTok-Signature', `t=${timestamp},s=${digest}`)
    .send(body.toString('utf8'));
}

function jsonBody(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

describe('TikTok signed webhook durable ACK', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    testApp = await createTestApp({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
      INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      TIKTOK_ADVERTISER_ID: ADVERTISER,
      TIKTOK_WEBHOOK_SECRET: SECRET,
    });
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
  });

  beforeEach(async () => {
    await dataSource.createQueryBuilder().delete().from(OutboxEntity).execute();
    await dataSource.createQueryBuilder().delete().from(OperationEntity).execute();
    await dataSource.createQueryBuilder().delete().from(WebhookEventEntity).execute();
  });

  afterAll(async () => {
    await testApp?.close();
    await infrastructure?.close();
  });

  it('stores the exact signed bytes and commits event, operation, and outbox before ACK', async () => {
    const raw = Buffer.from(
      '{ "event_id":"event-raw", "event":"lead.generate", "advertiser_id":"webhook-advertiser-test", "timestamp":"2024-03-01T10:15:00Z", "campaign_id":"campaign-1", "form_id":"form-1", "lead_data":{"name":"Tiếng Việt"} }',
      'utf8',
    );
    await signedRequest(testApp, raw)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ received: true, duplicate: false });
      });
    const event = await dataSource
      .getRepository(WebhookEventEntity)
      .findOneByOrFail({ eventKey: 'event-raw' });
    expect(event.rawBody).toEqual(raw);
    expect(await dataSource.getRepository(OperationEntity).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEntity).count()).toBe(1);
    expect(
      (
        await dataSource.getRepository(OutboxEntity).findOneByOrFail({
          operationId: (
            await dataSource
              .getRepository(OperationEntity)
              .findOneByOrFail({ operationKey: `tiktok-ingest/${event.id}` })
          ).id,
        })
      ).publishedAt,
    ).toBeNull();
  });

  it('returns one non-duplicate receipt for concurrent deliveries of the same event', async () => {
    const body = jsonBody(leadEvent('event-concurrent'));
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => signedRequest(testApp, body)),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses.filter((response) => response.body.duplicate === false)).toHaveLength(1);
    expect(await dataSource.getRepository(WebhookEventEntity).count()).toBe(1);
    expect(await dataSource.getRepository(OperationEntity).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEntity).count()).toBe(1);
  });

  it('rejects changed content for an existing event key and blocks another advertiser', async () => {
    await signedRequest(testApp, jsonBody(leadEvent('event-reused'))).expect(200);
    await signedRequest(
      testApp,
      jsonBody({ ...leadEvent('event-reused'), timestamp: '2024-03-02T10:15:00Z' }),
    ).expect(409);
    await signedRequest(
      testApp,
      jsonBody({ ...leadEvent('event-forbidden'), advertiser_id: 'other-advertiser' }),
    ).expect(403);
  });

  it('returns 401 for bad or duplicate signature fields and 400 for excessive JSON depth', async () => {
    const body = jsonBody(leadEvent('event-bad-depth'));
    await request(testApp.app.getHttpServer())
      .post('/webhooks/tiktok/leads')
      .set('Content-Type', 'application/json')
      .set('TikTok-Signature', 't=1,t=1,s=00')
      .send(body)
      .expect(401);
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let index = 0; index < 20; index += 1) {
      const child: Record<string, unknown> = {};
      cursor.value = child;
      cursor = child;
    }
    const deepBody = jsonBody({ ...leadEvent('event-too-deep'), extra: nested });
    await signedRequest(testApp, deepBody).expect(400);
  });

  it('accepts a 256 KiB body and returns 413 for one byte more', async () => {
    const base = leadEvent('event-max-size');
    const seed = jsonBody({ ...base, padding: '' });
    const exact = jsonBody({ ...base, padding: 'x'.repeat(256 * 1024 - seed.length) });
    expect(exact.length).toBe(256 * 1024);
    await signedRequest(testApp, exact).expect(200);
    const oversized = Buffer.concat([exact, Buffer.from(' ')]);
    await signedRequest(testApp, oversized).expect(413);
  });

  it('persists unsupported authenticated events as ignored without dispatching work', async () => {
    const body = jsonBody({ ...leadEvent('event-ignored'), event: 'profile.open' });
    await signedRequest(testApp, body).expect(200);
    expect(
      (
        await dataSource
          .getRepository(WebhookEventEntity)
          .findOneByOrFail({ eventKey: 'event-ignored' })
      ).status,
    ).toBe('ignored');
    expect(await dataSource.getRepository(OperationEntity).count()).toBe(0);
    expect(await dataSource.getRepository(OutboxEntity).count()).toBe(0);
  });

  it('maps a database transaction outage to 503 without ACKing uncommitted input', async () => {
    const spy = jest
      .spyOn(dataSource, 'transaction')
      .mockRejectedValueOnce(new Error('database unavailable'));
    try {
      await signedRequest(testApp, jsonBody(leadEvent('event-db-down'))).expect(503);
      expect(await dataSource.getRepository(WebhookEventEntity).count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('durably ACKs while the app Redis clients are disconnected', async () => {
    const redis = testApp.app.get<RedisConnectionFactory>(REDIS_CONNECTION_FACTORY);
    await redis.closeAll();
    const body = jsonBody(leadEvent('event-redis-down'));
    await signedRequest(testApp, body).expect(200);
    expect(await dataSource.getRepository(WebhookEventEntity).count()).toBe(1);
    expect(await dataSource.getRepository(OperationEntity).count()).toBe(1);
    expect(await dataSource.getRepository(OutboxEntity).count()).toBe(1);
  });
});
