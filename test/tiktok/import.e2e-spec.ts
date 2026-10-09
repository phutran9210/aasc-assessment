import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { CampaignCostImportService } from '@modules/integration-reports/services/campaign-cost-import.service.js';
import { LeadImportService } from '@modules/integration-reports/services/lead-import.service.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';
const ADVERTISER = 'mock-advertiser';
const LEADS = '/api/v1/leads/imports';
const COSTS = '/api/v1/analytics/campaign-costs/imports';

describe('import API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let artifactDir: string;
  let leadsCsv: Buffer;
  let costsCsv: Buffer;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    artifactDir = await mkdtemp(join(tmpdir(), 'aasc-import-e2e-'));
    leadsCsv = await readFile('samples/tiktok/historical-leads.csv');
    costsCsv = await readFile('samples/tiktok/campaign-costs.csv');
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
      ['operator', 'integration_operator'],
      ['other', 'integration_operator'],
      ['analyst', 'integration_analyst'],
    ] as const) {
      const username = `import-${name}-${randomUUID()}`;
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
  });

  afterAll(async () => {
    await testApp.close();
    await infrastructure.close();
    await rm(artifactDir, { recursive: true, force: true });
  });

  const http = () => request(testApp.app.getHttpServer());
  const as = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });
  const pendingUploads = async () =>
    (await readdir(join(artifactDir, 'tmp')).catch(() => [])).filter((name) =>
      name.endsWith('.upload'),
    );

  it('requires an operator or administrator before anything is written', async () => {
    await http().post(LEADS).attach('file', leadsCsv, 'leads.csv').expect(401);
    await http().post(LEADS).set(as('analyst')).attach('file', leadsCsv, 'leads.csv').expect(403);
    await http().post(COSTS).set(as('analyst')).attach('file', costsCsv, 'costs.csv').expect(403);

    expect(await pendingUploads()).toEqual([]);
    expect(await dataSource.getRepository(ReportJobEntity).count()).toBe(0);
  });

  it('accepts the sample lead file as a dry run by default and reports per-row diagnostics', async () => {
    const created = await http()
      .post(LEADS)
      .set(as('operator'))
      .attach('file', leadsCsv, 'historical-leads.csv')
      .expect(202);
    const jobId = created.body.id as string;

    expect(created.body).toMatchObject({
      kind: 'import',
      status: 'pending',
      totalRows: 3,
      filters: { type: 'leads', dryRun: true, applyRules: false, sendFeedback: false },
    });
    expect(created.body).not.toHaveProperty('artifactPath');
    expect(await pendingUploads()).toEqual([]);

    await testApp.app.get(LeadImportService).processChunk(jobId, 0);

    const status = await http()
      .get(`/api/v1/reports/jobs/${jobId}`)
      .set(as('operator'))
      .expect(200);
    expect(status.body).toMatchObject({
      status: 'completed',
      successRows: 3,
      failedRows: 0,
      rowErrors: [],
      filters: { preview: { create: 3, merge: 0, noop: 0 } },
    });
    expect(await dataSource.getRepository(LeadEntity).count()).toBe(0);
    await http().get(`/api/v1/reports/jobs/${jobId}`).set(as('other')).expect(403);
    await http().get(`/api/v1/reports/jobs/${jobId}/download`).set(as('operator')).expect(404);
  });

  it('passes explicit options through and returns redacted row errors', async () => {
    const csv = [
      'advertiser_id,source_record_id,occurred_at,full_name,email',
      `${ADVERTISER},row-1,2026-06-01T00:00:00Z,Valid Person,valid@example.test`,
      `${ADVERTISER},,2026-06-01T00:00:00Z,No Source,private@example.test`,
    ].join('\n');
    const created = await http()
      .post(LEADS)
      .set(as('operator'))
      .field('dryRun', 'true')
      .field('applyRules', 'true')
      .attach('file', Buffer.from(csv), 'leads.csv')
      .expect(202);
    expect(created.body.filters).toMatchObject({ dryRun: true, applyRules: true });

    await testApp.app.get(LeadImportService).processChunk(created.body.id as string, 0);
    const status = await http()
      .get(`/api/v1/reports/jobs/${created.body.id}`)
      .set(as('operator'))
      .expect(200);

    expect(status.body.rowErrors).toEqual([
      {
        rowNumber: 2,
        sourceKey: null,
        errorCode: 'SOURCE_RECORD_ID_MISSING',
        detail: 'source_record_id',
      },
    ]);
    expect(JSON.stringify(status.body)).not.toContain('private@example.test');
  });

  it('rejects bad requests and leaves no upload behind', async () => {
    await http().post(LEADS).set(as('operator')).field('dryRun', 'true').expect(400);
    await http()
      .post(LEADS)
      .set(as('operator'))
      .field('dryRun', 'maybe')
      .attach('file', leadsCsv, 'leads.csv')
      .expect(400);
    await http()
      .post(LEADS)
      .set(as('operator'))
      .field('path', '/etc/passwd')
      .attach('file', leadsCsv, 'leads.csv')
      .expect(400);
    await http()
      .post(LEADS)
      .set(as('operator'))
      .attach('file', Buffer.from('a,a\n1,2\n'), 'leads.csv')
      .expect(400);
    await http().post(LEADS).set(as('operator')).attach('file', leadsCsv, 'leads.xlsx').expect(400);
    await http()
      .post(COSTS)
      .set(as('operator'))
      .attach('file', Buffer.from('[]'), 'costs.json')
      .expect(400);

    expect(await pendingUploads()).toEqual([]);
  });

  it('refuses an upload larger than 10 MiB', async () => {
    const header = 'advertiser_id,source_record_id,occurred_at,full_name,email\n';
    const oversized = Buffer.concat([
      Buffer.from(header),
      Buffer.alloc(10 * 1024 * 1024 - header.length + 1, 0x78),
    ]);

    await http().post(LEADS).set(as('operator')).attach('file', oversized, 'leads.csv').expect(413);
    expect(await pendingUploads()).toEqual([]);
  });

  it('imports the sample campaign costs', async () => {
    const created = await http()
      .post(COSTS)
      .set(as('operator'))
      .attach('file', costsCsv, 'campaign-costs.csv')
      .expect(202);
    expect(created.body).toMatchObject({
      kind: 'import',
      totalRows: 4,
      filters: { type: 'campaign_costs', format: 'csv' },
    });

    await testApp.app.get(CampaignCostImportService).processChunk(created.body.id as string, 0);

    const status = await http()
      .get(`/api/v1/reports/jobs/${created.body.id}`)
      .set(as('operator'))
      .expect(200);
    expect(status.body).toMatchObject({ status: 'completed', successRows: 4, failedRows: 0 });
    const rows = await dataSource
      .getRepository(CampaignDailyEntity)
      .find({ order: { campaignId: 'ASC', reportDate: 'ASC' } });
    expect(rows.map((row) => [row.campaignId, row.reportDate, row.spend, row.source])).toEqual([
      ['cmp-spring', '2026-07-01', '350000.5000', 'import'],
      ['cmp-spring', '2026-07-02', '0.0000', 'import'],
      ['cmp-spring', '2026-07-03', '410000.0000', 'import'],
      ['cmp-summer', '2026-07-05', '275000.2500', 'import'],
    ]);
  });
});
