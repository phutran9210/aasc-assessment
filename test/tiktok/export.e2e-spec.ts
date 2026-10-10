import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import type { OperationContext } from '@core/queue/types/worker.types.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { ExportService } from '@modules/integration-reports/services/export.service.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';
const ADVERTISER = 'advertiser-export-e2e';
const RANGE = 'from=2026-09-01&to=2026-09-03';

describe('report export API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let artifactDir: string;
  let leadId: string;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    artifactDir = await mkdtemp(join(tmpdir(), 'aasc-export-e2e-'));
    testApp = await createTestApp({
      TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
      TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
      TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
      INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      INTEGRATION_ARTIFACT_DIR: artifactDir,
      TIKTOK_ADVERTISER_ID: ADVERTISER,
    });
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));

    const bcrypt = await import('bcrypt');
    for (const [name, role] of [
      ['analyst', 'integration_analyst'],
      ['other', 'integration_analyst'],
      ['operator', 'integration_operator'],
      ['admin', 'integration_admin'],
    ] as const) {
      const username = `export-${name}-${randomUUID()}`;
      await dataSource.getRepository(IntegrationUserEntity).save({
        id: randomUUID(),
        username,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        roles: [role],
        active: true,
        authVersion: 1,
      });
      const login = await request(testApp.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username, password: PASSWORD })
        .expect(200);
      tokens[name] = login.body.accessToken as string;
    }

    const fixtures = analyticsFixtures(dataSource, ADVERTISER);
    leadId = await fixtures.saveLead({
      firstTouchAt: new Date('2026-09-01T05:00:00Z'),
      phone: '+84901234567',
    });
    await fixtures.saveDeal({ leadId, stageSemantics: 'won', amount: '250000' });
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
    await rm(artifactDir, { recursive: true, force: true });
  });

  const http = () => request(testApp.app.getHttpServer());
  const as = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });

  it('requires authentication and the analyst or admin role', async () => {
    await http().get(`/api/v1/reports/export?${RANGE}`).expect(401);
    await http().get(`/api/v1/reports/export?${RANGE}`).set(as('operator')).expect(403);
    await http().post('/api/v1/reports/exports').set(as('operator')).send({}).expect(403);
  });

  it('downloads CSV with attachment headers, a BOM and snapshot metadata', async () => {
    const response = await http()
      .get(`/api/v1/reports/export?format=csv&${RANGE}`)
      .set(as('analyst'))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const body = response.body as Buffer;
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="leads-.*\.csv"$/,
    );
    expect(response.headers['x-export-row-count']).toBe('1');
    expect(response.headers['x-export-time-basis']).toBe('createdAt');
    expect(response.headers['x-export-provider-mode']).toBe('mock/mock');
    expect(Number.isNaN(Date.parse(response.headers['x-export-snapshot-at']))).toBe(false);
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.toString('utf8')).toContain(`${leadId},`);
    expect(body.toString('utf8')).toContain(`,'+84901234567,`);
  });

  it('downloads JSON rows and an XLSX workbook', async () => {
    const json = await http()
      .get(`/api/v1/reports/export?format=json&${RANGE}`)
      .set(as('admin'))
      .expect(200);
    expect(json.body).toEqual([
      expect.objectContaining({ localLeadId: leadId, phone: '+84901234567', amount: '250000' }),
    ]);

    const xlsx = await http()
      .get(`/api/v1/reports/export?format=xlsx&${RANGE}`)
      .set(as('analyst'))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect((xlsx.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it.each([
    [`/api/v1/reports/export?format=pdf&${RANGE}`],
    [`/api/v1/reports/export?scope=deals&${RANGE}`],
    ['/api/v1/reports/export?date_range=30d&from=2026-09-01&to=2026-09-02'],
    ['/api/v1/reports/export?timezone=Nowhere/City'],
    ['/api/v1/reports/export?secret=1'],
  ])('rejects %s with 400', async (path) => {
    await http().get(path).set(as('analyst')).expect(400);
  });

  it('runs an asynchronous export that only its requester or an admin can read', async () => {
    const created = await http()
      .post('/api/v1/reports/exports')
      .set(as('analyst'))
      .send({ format: 'json', from: '2026-09-01', to: '2026-09-03' })
      .expect(202);
    const jobId = created.body.id as string;
    expect(created.body).toMatchObject({ kind: 'export', status: 'pending', format: 'json' });
    expect(created.body).not.toHaveProperty('artifactPath');

    await http().get(`/api/v1/reports/jobs/${jobId}/download`).set(as('analyst')).expect(409);
    await http().get(`/api/v1/reports/jobs/${jobId}`).set(as('other')).expect(403);
    await http().get(`/api/v1/reports/jobs/${jobId}/download`).set(as('other')).expect(403);

    const outcome = await testApp.app
      .get(ExportService)
      .execute(jobId, { operationId: randomUUID(), attempt: 1 } as OperationContext);
    expect(outcome).toEqual({ outcome: 'succeeded' });

    const status = await http().get(`/api/v1/reports/jobs/${jobId}`).set(as('analyst')).expect(200);
    expect(status.body).toMatchObject({ status: 'completed', totalRows: 1 });
    const download = await http()
      .get(`/api/v1/reports/jobs/${jobId}/download`)
      .set(as('analyst'))
      .expect(200);
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="leads-${jobId}.json"`,
    );
    expect(download.body).toEqual([expect.objectContaining({ localLeadId: leadId })]);
    await http().get(`/api/v1/reports/jobs/${jobId}/download`).set(as('admin')).expect(200);
    await http().get(`/api/v1/reports/jobs/${jobId}/download`).set(as('other')).expect(403);
  });

  it('answers 404 for an unknown job and 400 for a malformed id', async () => {
    await http().get(`/api/v1/reports/jobs/${randomUUID()}`).set(as('analyst')).expect(404);
    await http().get('/api/v1/reports/jobs/..%2F..%2Fetc/download').set(as('analyst')).expect(400);
  });
});
