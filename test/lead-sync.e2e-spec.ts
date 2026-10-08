import { SheetsClient } from '@modules/google-sheets/index.js';
import type { SheetCell } from '@modules/google-sheets/index.js';
import { LeadSyncRunItem } from '@modules/lead-sync/entities/lead-sync-run-item.entity.js';
import { LeadSyncRun } from '@modules/lead-sync/entities/lead-sync-run.entity.js';
import { BitrixLeadGateway } from '@modules/lead-sync/gateways/bitrix-lead.gateway.js';
import { SyncScheduler } from '@modules/lead-sync/index.js';
import { LeadSyncReadiness } from '@modules/lead-sync/services/lead-sync-readiness.service.js';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';

import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { FakeLeadGateway } from '../src/modules/lead-sync/__tests__/support/fake-lead-gateway.js';
import { FakeSheetsClient } from '../src/modules/lead-sync/__tests__/support/fake-sheets-client.js';
import { createTestApp } from './utils/create-test-app.js';

// The nine standard columns of config/mapping.json, which the real MappingLoader reads.
const HEADERS = [
  'Tên khách hàng',
  'Email',
  'Số điện thoại',
  'Công ty',
  'Nguồn lead (UTM Source)',
  'Ngân sách dự kiến',
  'Trạng thái',
  'Người phụ trách',
  'Ghi chú',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '0199a1b2-c3d4-7e5f-8a6b-0123456789ab';

const lead = (n: number): SheetCell[] => [
  `Khách ${n}`,
  `khach${n}@example.com`,
  `09${String(n).padStart(8, '0')}`,
  'ACME',
  'facebook',
  1000000,
  'Mới',
  '',
  '',
];

async function login(app: NestExpressApplication, username: string): Promise<string> {
  const credentials = { username, password: 'matkhau123' };
  await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send(credentials)
    .expect(200);
  return response.body.accessToken as string;
}

describe('Lead sync (e2e)', () => {
  const sheet = new FakeSheetsClient(HEADERS, []);
  const gateway = new FakeLeadGateway();
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let token: string;

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string) => http().post(path).set('Authorization', `Bearer ${token}`);

  /** Polls the run until it leaves `running`. */
  const finished = async (runId: string): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await get(`/lead-sync/runs/${runId}`).expect(200);
      if (response.body.status !== 'running') return response.body as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Run ${runId} did not finish`);
  };

  const trigger = async (body: Record<string, unknown> = {}): Promise<string> => {
    const response = await post('/lead-sync/runs').send(body).expect(202);
    return response.body.runId as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SheetsClient)
      .useValue(sheet)
      .overrideProvider(BitrixLeadGateway)
      .useValue(gateway)
      .overrideProvider(LeadSyncReadiness)
      .useValue({ missing: () => Promise.resolve(null) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app, 'lead_sync_admin');
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    sheet.grid = [[...HEADERS], lead(1), lead(2)];
    sheet.calls = { read: 0, write: 0 };
    gateway.leads.clear();
    gateway.rejectRows.clear();
    gateway.gate = undefined;
    gateway.calls = { mode: 0, fields: 0, find: 0, get: 0, write: 0 };
    await dataSource.getRepository(LeadSyncRunItem).clear();
    await dataSource.getRepository(LeadSyncRun).clear();
  });

  it.each([
    ['post', '/lead-sync/runs'],
    ['get', '/lead-sync/runs'],
    ['get', `/lead-sync/runs/${UNKNOWN_ID}`],
    ['get', '/lead-sync/status'],
  ] as const)('should answer 401 to %s %s without a token', async (method, path) => {
    await http()[method](path).expect(401);
    expect(gateway.calls.write).toBe(0);
  });

  it('should accept a run with 202, sync in the background and report the result', async () => {
    const response = await post('/lead-sync/runs').send({}).expect(202);
    expect(response.body).toEqual({ runId: expect.stringMatching(UUID) });

    const run = await finished(response.body.runId as string);

    expect(run).toMatchObject({
      id: response.body.runId,
      trigger: 'http',
      status: 'succeeded',
      dryRun: false,
      total: 2,
      created: 2,
      updated: 0,
      skipped: 0,
      failed: 0,
      stopReason: null,
    });
    expect(run.items).toEqual([
      expect.objectContaining({ rowNumber: 2, action: 'create', attempts: 1 }),
      expect.objectContaining({ rowNumber: 3, action: 'create', attempts: 1 }),
    ]);
    expect(gateway.leads.size).toBe(2);
    expect(sheet.cell(2, 'Trạng thái đồng bộ')).toBe('Đã đồng bộ');
    expect(sheet.cell(3, 'Lead ID Bitrix24')).not.toBe('');
  });

  it('should accept a request without a body', async () => {
    const response = await post('/lead-sync/runs').expect(202);

    await expect(finished(response.body.runId as string)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('should plan without writing when dryRun is true', async () => {
    const run = await finished(await trigger({ dryRun: true }));

    expect(run).toMatchObject({ status: 'succeeded', dryRun: true, created: 2 });
    expect(gateway.calls.write).toBe(0);
    expect(sheet.calls.write).toBe(0);
  });

  it('should send unchanged rows again when force is true', async () => {
    await finished(await trigger());

    await expect(finished(await trigger())).resolves.toMatchObject({ skipped: 2, updated: 0 });
    await expect(finished(await trigger({ force: true }))).resolves.toMatchObject({
      skipped: 0,
      updated: 2,
    });
  });

  it('should answer 400 to a body with a wrong type or an unknown field', async () => {
    const wrongType = await post('/lead-sync/runs').send({ dryRun: 'yes' }).expect(400);
    expect(wrongType.body.message).toEqual(['dryRun phải là true hoặc false']);

    await post('/lead-sync/runs').send({ everything: true }).expect(400);
    expect(gateway.calls.find).toBe(0);
  });

  it('should answer 409 naming the run in progress, then accept a run again once it ends', async () => {
    let release: () => void = () => undefined;
    gateway.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runId = await trigger();

    const conflict = await post('/lead-sync/runs').send({}).expect(409);
    expect(conflict.body.message).toBe(`Đang có một lần đồng bộ khác chạy: ${runId}`);

    release();
    await finished(runId);
    // Wait for this run too: the next test clears the table it is still writing to.
    await finished(await trigger());
  });

  it('should list runs newest first with pagination', async () => {
    const first = await trigger();
    await finished(first);
    const second = await trigger();
    await finished(second);

    const page = await get('/lead-sync/runs?page=1&limit=1').expect(200);

    expect(page.body.meta).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0]).toMatchObject({ id: second, status: 'succeeded', skipped: 2 });
    expect(page.body.data[0]).not.toHaveProperty('items');
    await get('/lead-sync/runs?limit=0').expect(400);
  });

  it('should show the failed rows of a run with their reason', async () => {
    sheet.setCell(3, 'Email', 'sai-email');
    gateway.rejectRows.set(2, { code: 'INVALID_ARG_VALUE', message: 'Invalid value' });

    const run = await finished(await trigger());

    expect(run).toMatchObject({ status: 'partial', created: 0, failed: 2 });
    expect(run.items).toEqual([
      {
        rowNumber: 2,
        action: 'fail',
        leadId: null,
        errorCode: 'INVALID_ARG_VALUE',
        errorMessage: 'Bitrix24 từ chối dữ liệu: Invalid value',
        attempts: 1,
      },
      {
        rowNumber: 3,
        action: 'fail',
        leadId: null,
        errorCode: 'VALIDATION',
        errorMessage: 'Cột "Email": email sai định dạng, ví dụ đúng: ten@congty.vn',
        attempts: 1,
      },
    ]);
  });

  it('should answer 404 for an unknown run and 400 for a malformed id', async () => {
    const missing = await get(`/lead-sync/runs/${UNKNOWN_ID}`).expect(404);
    expect(missing.body.message).toBe('Không tìm thấy lần chạy');

    await get('/lead-sync/runs/not-a-uuid').expect(400);
  });

  it('should report the schedule, the last run and both connections', async () => {
    const runId = await trigger();
    await finished(runId);

    const response = await get('/lead-sync/status').expect(200);

    expect(response.body).toEqual({
      configured: true,
      reason: null,
      schedule: { cron: '*/15 * * * *', timezone: 'Asia/Ho_Chi_Minh', nextRunAt: null },
      lastRun: expect.objectContaining({ id: runId, status: 'succeeded' }),
      connections: {
        google: { ok: true, message: null },
        bitrix: { ok: true, message: null },
      },
    });
  });

  it('should not start the schedule by booting the app: only main.ts does', async () => {
    const registry = app.get(SchedulerRegistry);
    expect(registry.getCronJobs().size).toBe(0);

    expect(app.get(SyncScheduler).start()).toBe(true);

    expect(registry.getCronJobs().size).toBe(1);
    const status = await get('/lead-sync/status').expect(200);
    expect(status.body.schedule.nextRunAt).toEqual(expect.any(String));
    registry.deleteCronJob('lead-sync');
  });
});

describe('Lead sync without configuration (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app, 'lead_sync_unconfigured');
  });

  afterAll(async () => app.close());

  it('should answer 503 naming what is missing, creating no run', async () => {
    const response = await request(app.getHttpServer())
      .post('/lead-sync/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(503);

    expect(response.body.message).toBe('Chưa cấu hình GOOGLE_SHEET_ID');

    const runs = await request(app.getHttpServer())
      .get('/lead-sync/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(runs.body.meta.total).toBe(0);
  });

  it('should still serve the status, explaining why the sync cannot run', async () => {
    const response = await request(app.getHttpServer())
      .get('/lead-sync/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      configured: false,
      reason: 'Chưa cấu hình GOOGLE_SHEET_ID',
      connections: {
        google: { ok: false, message: 'Chưa cấu hình GOOGLE_SHEET_ID' },
        bitrix: { ok: false, message: 'Chưa cấu hình GOOGLE_SHEET_ID' },
      },
    });
  });
});
