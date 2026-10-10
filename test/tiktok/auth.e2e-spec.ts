import { randomUUID } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';
import { AuthTestModule } from './utils/auth-test.module.js';

const PASSWORD = 'safe-test-password-123';

describe('TikTok authentication and RBAC (e2e)', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let userId: string;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    testApp = await createTestApp(
      {
        TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
        TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
        TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
        INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      },
      AuthTestModule,
    );
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
  });

  beforeEach(async () => {
    await dataSource.getRepository(IntegrationUserEntity).clear();
    userId = randomUUID();
    await dataSource.getRepository(IntegrationUserEntity).save({
      id: userId,
      username: 'analyst-test',
      passwordHash: await bcryptHash(PASSWORD),
      roles: ['integration_analyst'],
      active: true,
      authVersion: 1,
    });
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
  });

  it('logs in, authorizes the current role, denies missing roles and rejects AASC JWTs', async () => {
    const [login, concurrentLogin] = await Promise.all([
      request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'analyst-test', password: PASSWORD })
        .expect(200),
      request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'analyst-test', password: PASSWORD })
        .expect(200),
    ]);
    const authorization = `Bearer ${login.body.accessToken}`;
    expect(concurrentLogin.body.accessToken).not.toBe(login.body.accessToken);

    await request(testApp.app.getHttpServer())
      .get('/test/auth/me')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ sub: userId, username: 'analyst-test' }));
    await request(testApp.app.getHttpServer())
      .get('/test/auth/admin')
      .set('Authorization', authorization)
      .expect(403);
    await request(testApp.app.getHttpServer()).get('/install/authorize').expect(401);
    await request(testApp.app.getHttpServer())
      .get('/install/authorize')
      .set('Authorization', authorization)
      .expect(403);

    const wrongIssuerToken = await new JwtService({
      secret: process.env.TIKTOK_JWT_SECRET,
    }).signAsync(
      { sub: userId, sid: randomUUID(), authVersion: 1 },
      { issuer: 'aasc-api', audience: 'aasc-client' },
    );
    await request(testApp.app.getHttpServer())
      .get('/test/auth/me')
      .set('Authorization', `Bearer ${wrongIssuerToken}`)
      .expect(401);

    await request(testApp.app.getHttpServer()).post('/api/v1/auth/register').expect(404);
  });

  it('revokes and replays sessions, and returns 204 for repeated logout', async () => {
    const login = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'analyst-test', password: PASSWORD })
      .expect(200);
    const authorization = `Bearer ${login.body.accessToken}`;

    await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', authorization)
      .expect(204);
    await request(testApp.app.getHttpServer())
      .get('/test/auth/me')
      .set('Authorization', authorization)
      .expect(401);
    await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', authorization)
      .expect(204);
  });

  it('invalidates a session after the user roles and auth version change', async () => {
    const login = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'analyst-test', password: PASSWORD })
      .expect(200);
    await dataSource
      .getRepository(IntegrationUserEntity)
      .update({ id: userId }, { roles: ['integration_admin'] });

    await request(testApp.app.getHttpServer())
      .get('/test/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });

  it('invalidates a session when the user is disabled', async () => {
    const login = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'analyst-test', password: PASSWORD })
      .expect(200);
    await dataSource.getRepository(IntegrationUserEntity).update({ id: userId }, { active: false });

    await request(testApp.app.getHttpServer())
      .get('/test/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });

  it('returns 503 when Redis session services are unavailable', async () => {
    const downApp = await createTestApp({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: 'redis://127.0.0.1:1',
      INTEGRATION_QUEUE_PREFIX: `${infrastructure.redisPrefix}-redis-down`,
    });
    try {
      await request(downApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'analyst-test', password: PASSWORD })
        .expect(503);
    } finally {
      await downApp.close();
    }
  });
});

async function bcryptHash(password: string): Promise<string> {
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, 4);
}
