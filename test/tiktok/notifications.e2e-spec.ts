import { randomUUID } from 'node:crypto';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { NotificationService } from '@modules/integration-reports/services/notification.service.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';

describe('notifications API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    testApp = await createTestApp({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
      INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
    });
    const dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
    const bcrypt = await import('bcrypt');
    for (const [name, role] of [
      ['operator', 'integration_operator'],
      ['analyst', 'integration_analyst'],
    ] as const) {
      const username = `notify-${name}-${randomUUID()}`;
      await dataSource.getRepository(IntegrationUserEntity).save({
        id: randomUUID(),
        username,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        roles: [role],
        active: true,
        authVersion: 1,
      });
      const login = await request(testApp.app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: PASSWORD })
        .expect(200);
      tokens[name] = login.body.accessToken as string;
    }
    const notifications = testApp.app.get(NotificationService);
    await dataSource.transaction(async (tx) => {
      for (const index of [1, 2, 3]) {
        await notifications.ensure(
          {
            dedupKey: `e2e/${index}`,
            type: 'report.ready',
            payload: { jobId: `job-${index}`, link: `/api/v1/reports/jobs/job-${index}/download` },
          },
          tx,
        );
      }
    });
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
  });

  const list = (name: string, query = '') =>
    request(testApp.app.getHttpServer())
      .get(`/api/v1/notifications${query}`)
      .set('Authorization', `Bearer ${tokens[name]}`);

  it('requires authentication', async () => {
    await request(testApp.app.getHttpServer()).get('/api/v1/notifications').expect(401);
  });

  it('pages the notifications addressed to the caller role, newest first', async () => {
    const response = await list('operator', '?page=1&limit=2').expect(200);

    expect(response.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(
      response.body.items.map((item: { payload: { jobId: string } }) => item.payload.jobId),
    ).toEqual(['job-3', 'job-2']);
    expect(response.body.items[0]).toMatchObject({ type: 'report.ready', status: 'pending' });
  });

  it('shows nothing to a role outside the audience and validates paging', async () => {
    expect((await list('analyst').expect(200)).body).toMatchObject({ total: 0, items: [] });
    await list('operator', '?limit=0').expect(400);
  });
});
