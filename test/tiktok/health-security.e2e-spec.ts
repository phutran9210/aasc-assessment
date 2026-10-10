import { createHmac, randomUUID } from 'node:crypto';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { USER_MUTATION_LIMIT } from '@modules/integration-auth/guards/integration-rate-limit.guard.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';
const ADVERTISER = 'health-security-advertiser';
const SECRET = 'health-security-webhook-secret-value';

function signedLead(app: TestApp, eventId: string) {
  const body = Buffer.from(
    JSON.stringify({
      event_id: eventId,
      event: 'lead.generate',
      advertiser_id: ADVERTISER,
      timestamp: '2026-03-01T10:15:00.000Z',
      campaign_id: 'campaign-1',
      form_id: 'form-1',
      lead_data: { name: 'Private Person', email: 'private.person@example.test' },
    }),
    'utf8',
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.`).update(body).digest('hex');
  return request(app.app.getHttpServer())
    .post('/webhooks/tiktok/leads')
    .set('Content-Type', 'application/json')
    .set('TikTok-Signature', `t=${timestamp},s=${digest}`)
    .send(body.toString('utf8'));
}

describe('health, limits and log hygiene', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let token: string;
  const baseEnv = () => ({
    TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
    TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
    INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
    TIKTOK_ADVERTISER_ID: ADVERTISER,
    TIKTOK_WEBHOOK_SECRET: SECRET,
  });

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    testApp = await createTestApp({
      ...baseEnv(),
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
    });
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
    const bcrypt = await import('bcrypt');
    const username = `health-operator-${randomUUID()}`;
    await dataSource.getRepository(IntegrationUserEntity).save({
      id: randomUUID(),
      username,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roles: ['integration_operator'],
      active: true,
      authVersion: 1,
    });
    const login = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    token = login.body.accessToken as string;
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
  });

  const http = () => request(testApp.app.getHttpServer());

  it('answers liveness without checking dependencies', async () => {
    expect((await http().get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
  });

  it('reports readiness on /health/ready and its /health alias without authentication', async () => {
    for (const path of ['/health/ready', '/health']) {
      const response = await http().get(path).expect(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        checks: { database: 'ok', schema: 'ok', redis: 'ok', config: 'ok' },
        providerMode: { tiktok: 'mock', bitrix: 'mock' },
      });
      const text = JSON.stringify(response.body);
      for (const secret of [SECRET, 'postgres://', 'redis://', process.env.TIKTOK_JWT_SECRET]) {
        expect(text).not.toContain(secret as string);
      }
    }
  });

  it('limits a user to 30 mutations per minute with Retry-After, reads stay available', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < USER_MUTATION_LIMIT + 1; index += 1) {
      const response = await http()
        .post('/api/v1/leads/imports')
        .set('Authorization', `Bearer ${token}`)
        .field('dryRun', 'true');
      statuses.push(response.status);
      if (response.status === 429) {
        expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(60);
        expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
      }
    }

    expect(statuses.slice(0, USER_MUTATION_LIMIT).every((status) => status === 400)).toBe(true);
    expect(statuses[USER_MUTATION_LIMIT]).toBe(429);
    await http().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`).expect(200);
  });

  describe('while Redis is unreachable', () => {
    let offline: TestApp;
    const output: string[] = [];
    let restore: () => void;

    beforeAll(async () => {
      const writers = [process.stdout, process.stderr].map((stream) => {
        const original = stream.write.bind(stream);
        stream.write = (chunk: unknown, ...rest: unknown[]) => {
          output.push(String(chunk));
          return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
        };
        return () => {
          stream.write = original;
        };
      });
      restore = () => writers.forEach((undo) => undo());
      offline = await createTestApp({ ...baseEnv(), TIKTOK_REDIS_URL: 'redis://127.0.0.1:1' });
    });

    afterAll(async () => {
      restore();
      await offline.close();
    });

    const down = () => request(offline.app.getHttpServer());

    it('is not ready, and says which dependency failed', async () => {
      const response = await down().get('/health/ready').expect(503);

      expect(response.body).toMatchObject({
        status: 'unavailable',
        checks: { database: 'ok', redis: 'down' },
      });
      expect((await down().get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    });

    it('still acknowledges a signed webhook after the database commit', async () => {
      const eventId = `redis-down-${randomUUID()}`;

      await signedLead(offline, eventId).expect(200);

      expect(
        await dataSource.getRepository(WebhookEventEntity).countBy({ eventKey: eventId }),
      ).toBe(1);
    });

    it('refuses sessions with 503 instead of letting requests through', async () => {
      await down()
        .post('/api/v1/auth/login')
        .send({ username: 'nobody', password: PASSWORD })
        .expect((response) => {
          expect([401, 503]).toContain(response.status);
        });
      await down().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`).expect(503);
      await down()
        .post('/api/v1/reports/exports')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(503);
    });

    it('never writes credentials or contact data to the log', () => {
      const logged = output.join('');

      for (const secret of [
        SECRET,
        token,
        PASSWORD,
        'private.person@example.test',
        process.env.TIKTOK_JWT_SECRET as string,
        'tiktok_test_only',
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});
