import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import ExcelJS from 'exceljs';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { OutboxEntity } from '@core/queue/entities/outbox.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { ExportRepository } from '@modules/integration-reports/repositories/export.repository.js';
import { ReportJobRepository } from '@modules/integration-reports/repositories/report-job.repository.js';
import { ArtifactService } from '@modules/integration-reports/services/artifact.service.js';
import {
  ASYNC_EXPORT_ROW_LIMIT,
  ExportService,
  SYNC_EXPORT_ROW_LIMIT,
} from '@modules/integration-reports/services/export.service.js';
import type { ExportServiceOptions } from '@modules/integration-reports/services/export.service.js';
import { analyticsFixtures } from './utils/analytics-fixtures.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const ADVERTISER = 'advertiser-export';
const NOW = '2026-10-09T05:30:00.000Z';
const range = { from: '2026-10-01', to: '2026-10-08' };
const context = { operationId: randomUUID(), attempt: 1 } as OperationContext;

const analyst = (): Actor => ({
  sub: randomUUID(),
  sid: randomUUID(),
  username: 'analyst',
  roles: ['integration_analyst'],
});

async function text(stream: Readable): Promise<string> {
  return (await buffer(stream)).toString('utf8');
}

async function buffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function files(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe('lead export', () => {
  let infrastructure: TestInfrastructure;
  let root: string;
  let jobs: ReportJobRepository;
  let artifacts: ArtifactService;
  let exportRepository: ExportRepository;
  let fixtures: ReturnType<typeof analyticsFixtures>;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    root = await mkdtemp(join(tmpdir(), 'aasc-export-'));
    const dataSource = infrastructure.database.dataSource;
    jobs = new ReportJobRepository(dataSource);
    artifacts = new ArtifactService(root, jobs);
    exportRepository = new ExportRepository(dataSource);
    fixtures = analyticsFixtures(dataSource, ADVERTISER);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await infrastructure.close();
  });

  beforeEach(async () => {
    const schema = infrastructure.database.schema;
    await infrastructure.database.dataSource.query(
      `TRUNCATE ${[
        'integration_report_job',
        'integration_deal',
        'integration_submission',
        'integration_lead',
        'integration_outbox',
        'integration_operation',
      ]
        .map((table) => `"${schema}"."${table}"`)
        .join(', ')} CASCADE`,
    );
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await rm(join(root, 'tmp'), { recursive: true, force: true });
  });

  function service(options: ExportServiceOptions = {}, artifactService = artifacts) {
    return new ExportService(
      infrastructure.database.dataSource,
      exportRepository,
      jobs,
      artifactService,
      new OperationRepository(),
      new OutboxRepository(),
      { advertiserId: ADVERTISER, tiktokMode: 'mock', bitrixMode: 'mock' },
      { clock: () => NOW, ...options },
    );
  }

  async function seed(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        await fixtures.saveLead({
          firstTouchAt: new Date(Date.UTC(2026, 9, 2, 0, index)),
          phone: '+84901234567',
        }),
      );
    }
    return ids;
  }

  async function hostileLead(): Promise<string> {
    const id = await fixtures.saveLead({
      firstTouchAt: new Date('2026-10-03T00:00:00Z'),
      phone: '+84901234567',
      campaignId: '1790000000000000001',
    });
    await infrastructure.database.dataSource
      .getRepository(LeadEntity)
      .update(id, { name: '=HYPERLINK("http://evil.test","x")', bitrixLeadId: '00123' });
    await fixtures.saveDeal({ leadId: id, stageSemantics: 'won', amount: '1500000.5' });
    return id;
  }

  it('writes CSV with a BOM, neutralized formulas and phone numbers kept as text', async () => {
    const id = await hostileLead();

    const artifact = await service().download({ ...range, format: 'csv' }, analyst());
    const body = await text(artifact.stream);

    expect(artifact).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      rowCount: 1,
      metadata: {
        from: '2026-09-30T17:00:00.000Z',
        to: '2026-10-07T17:00:00.000Z',
        timeBasis: 'createdAt',
        providerMode: { tiktok: 'mock', bitrix: 'mock' },
      },
    });
    expect(artifact.filename).toMatch(/^leads-.*\.csv$/);
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = body.slice(1).split('\r\n');
    expect(header.split(',').slice(0, 5)).toEqual([
      'localLeadId',
      'remoteLeadId',
      'name',
      'email',
      'phone',
    ]);
    expect(row).toContain(`${id},00123,"'=HYPERLINK(""http://evil.test"",""x"")"`);
    expect(row).toContain(`,'+84901234567,1790000000000000001,`);
    expect(row).toContain(',1500000.5,VND,');
    expect(await files(join(root, 'tmp'))).toEqual([]);
  });

  it('writes JSON as an array of export DTOs with raw values', async () => {
    const id = await hostileLead();

    const artifact = await service().download({ ...range, format: 'json' }, analyst());
    const rows = JSON.parse(await text(artifact.stream)) as Array<Record<string, unknown>>;

    expect(artifact.contentType).toBe('application/json; charset=utf-8');
    expect(rows).toEqual([
      expect.objectContaining({
        localLeadId: id,
        remoteLeadId: '00123',
        name: '=HYPERLINK("http://evil.test","x")',
        phone: '+84901234567',
        campaignId: '1790000000000000001',
        score: 50,
        amount: '1500000.5',
        currency: 'VND',
        syncStatus: 'synced',
      }),
    ]);
    expect(Object.keys(rows[0])).toHaveLength(21);
    expect(
      JSON.parse(
        await text(
          (
            await service().download(
              { from: '2020-01-01', to: '2020-01-02', format: 'json' },
              analyst(),
            )
          ).stream,
        ),
      ),
    ).toEqual([]);
  });

  it('writes XLSX with phone numbers and identifiers typed as text', async () => {
    await hostileLead();

    const artifact = await service().download({ ...range, format: 'xlsx' }, analyst());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buffer(artifact.stream)) as never);
    const sheet = workbook.worksheets[0];
    const headers = (sheet.getRow(1).values as string[]).slice(1);
    const cell = (key: string) => sheet.getRow(2).getCell(headers.indexOf(key) + 1);

    expect(artifact.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    for (const key of ['phone', 'remoteLeadId', 'campaignId', 'amount']) {
      expect(cell(key).type).toBe(ExcelJS.ValueType.String);
    }
    expect(cell('phone').value).toBe('+84901234567');
    expect(cell('remoteLeadId').value).toBe('00123');
    expect(cell('campaignId').value).toBe('1790000000000000001');
    expect(cell('name').value).toBe(`'=HYPERLINK("http://evil.test","x")`);
    expect(cell('score').type).toBe(ExcelJS.ValueType.Number);
  });

  it('refuses a synchronous export above the row limit with EXPORT_REQUIRES_ASYNC', async () => {
    await seed(4);

    await expect(
      service({ syncLimit: 3 }).download({ ...range, format: 'csv' }, analyst()),
    ).rejects.toMatchObject({ status: 422, response: { code: 'EXPORT_REQUIRES_ASYNC' } });
    expect(SYNC_EXPORT_ROW_LIMIT).toBe(10_000);
    expect(ASYNC_EXPORT_ROW_LIMIT).toBe(100_000);
  });

  it('only exports the requested advertiser, period and campaign', async () => {
    const [inside] = await seed(1);
    await fixtures.saveLead({ firstTouchAt: new Date('2026-09-01T00:00:00Z') });
    await fixtures.saveLead({
      firstTouchAt: new Date('2026-10-02T00:00:00Z'),
      campaignId: 'cmp-2',
    });
    await fixtures.saveLead({
      firstTouchAt: new Date('2026-10-02T00:00:00Z'),
      advertiserId: 'someone-else',
    });

    const artifact = await service().download(
      { ...range, format: 'json', campaignId: 'cmp-1' },
      analyst(),
    );
    const rows = JSON.parse(await text(artifact.stream)) as Array<{ localLeadId: string }>;

    expect(rows.map((row) => row.localLeadId)).toEqual([inside]);
  });

  it('pages by keyset inside one snapshot, ignoring rows committed during the export', async () => {
    const ids = await seed(5);
    const original = exportRepository.page.bind(exportRepository);
    let calls = 0;
    const page = jest.spyOn(exportRepository, 'page').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) await seed(1);
      return original(...args);
    });

    const artifact = await service({ pageSize: 2 }).download(
      { ...range, format: 'json' },
      analyst(),
    );
    const rows = JSON.parse(await text(artifact.stream)) as Array<{ localLeadId: string }>;
    page.mockRestore();

    expect(calls).toBeGreaterThanOrEqual(3);
    expect(rows.map((row) => row.localLeadId)).toEqual(ids);
    expect(artifact.rowCount).toBe(5);
  });

  it('schedules an asynchronous export and completes it with a finalized artifact', async () => {
    const ids = await seed(3);
    const actor = analyst();
    const exporter = service();

    const job = await exporter.schedule({ ...range, format: 'csv' }, actor);
    expect(job).toMatchObject({ kind: 'export', status: 'pending', format: 'csv' });
    const operation = await infrastructure.database.dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ operationKey: `report-export/${job.id}` });
    expect(operation).toMatchObject({ kind: 'integration_report', aggregateId: job.id });
    expect(
      await infrastructure.database.dataSource
        .getRepository(OutboxEntity)
        .count({ where: { operationId: operation.id } }),
    ).toBe(1);
    await expect(artifacts.openAuthorized(job.id, actor)).rejects.toMatchObject({ status: 409 });

    expect(await exporter.execute(job.id, context)).toEqual({ outcome: 'succeeded' });

    const finished = await exporter.getJob(job.id, actor);
    expect(finished).toMatchObject({ status: 'completed', totalRows: 3, successRows: 3 });
    expect(finished.snapshotAt).not.toBeNull();
    expect(Date.parse(finished.expiresAt as string) - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect(finished).not.toHaveProperty('artifactPath');
    const download = await artifacts.openAuthorized(job.id, actor);
    const body = await text(download.stream);
    expect(download).toMatchObject({ contentType: 'text/csv; charset=utf-8' });
    for (const id of ids) expect(body).toContain(id);
    expect(await files(join(root, 'exports'))).toHaveLength(1);
    expect(await exporter.execute(job.id, context)).toEqual({ outcome: 'succeeded' });
    expect(await files(join(root, 'exports'))).toHaveLength(1);
  });

  it('rejects an asynchronous export above the job quota', async () => {
    await seed(3);

    await expect(
      service({ asyncLimit: 2 }).schedule({ ...range, format: 'csv' }, analyst()),
    ).rejects.toMatchObject({ status: 422, response: { code: 'EXPORT_TOO_LARGE' } });
    expect(await infrastructure.database.dataSource.getRepository(ReportJobEntity).count()).toBe(0);
  });

  it('allows at most two active export jobs per user, even when requested concurrently', async () => {
    const actor = analyst();
    const exporter = service();

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => exporter.schedule({ ...range, format: 'json' }, actor)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => (result.reason as { status: number }).status),
    ).toEqual([429, 429]);
    await expect(exporter.schedule({ ...range, format: 'json' }, analyst())).resolves.toMatchObject(
      {
        status: 'pending',
      },
    );
  });

  it('keeps the artifact unavailable when the worker dies before finalize, then retries cleanly', async () => {
    await seed(3);
    const actor = analyst();
    const crashing = new ArtifactService(root, jobs);
    const finalize = jest
      .spyOn(crashing, 'finalize')
      .mockRejectedValueOnce(new Error('worker killed before rename'));
    const exporter = service({}, crashing);
    const job = await exporter.schedule({ ...range, format: 'json' }, actor);

    const first = await exporter.execute(job.id, context);
    const download = await crashing.openAuthorized(job.id, actor).catch((error: unknown) => error);

    expect(first).toMatchObject({ outcome: 'retry_wait', errorCode: 'EXPORT_FAILED' });
    expect((download as { status: number }).status).toBe(409);
    expect(await files(join(root, 'exports'))).toEqual([]);

    await seed(1);
    expect(await exporter.execute(job.id, { ...context, attempt: 2 })).toEqual({
      outcome: 'succeeded',
    });
    const rows = JSON.parse(
      await text((await crashing.openAuthorized(job.id, actor)).stream),
    ) as unknown[];
    expect(rows).toHaveLength(4);
    expect(await files(join(root, 'exports'))).toHaveLength(1);
    expect(await files(join(root, 'tmp'))).toEqual([]);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it('discards an artifact that was renamed but never recorded, instead of serving it', async () => {
    await seed(2);
    const actor = analyst();
    const exporter = service();
    const job = await exporter.schedule({ ...range, format: 'json' }, actor);
    const complete = jest
      .spyOn(jobs, 'complete')
      .mockRejectedValueOnce(new Error('database connection lost'));

    expect(await exporter.execute(job.id, context)).toMatchObject({ outcome: 'retry_wait' });
    expect(await files(join(root, 'exports'))).toHaveLength(1);
    await expect(artifacts.openAuthorized(job.id, actor)).rejects.toMatchObject({ status: 409 });

    expect(await exporter.execute(job.id, { ...context, attempt: 2 })).toEqual({
      outcome: 'succeeded',
    });
    complete.mockRestore();
    const stored = await jobs.findById(job.id);
    expect(await files(join(root, 'exports'))).toEqual([
      (stored?.artifactPath as string).split('/').at(-1),
    ]);
  });

  it('gives up after the last attempt and records the failure on the job', async () => {
    await seed(1);
    const actor = analyst();
    const crashing = new ArtifactService(root, jobs);
    jest.spyOn(crashing, 'finalize').mockRejectedValue(new Error('disk full'));
    const exporter = service({}, crashing);
    const job = await exporter.schedule({ ...range, format: 'csv' }, actor);

    expect(await exporter.execute(job.id, { ...context, attempt: 5 })).toMatchObject({
      outcome: 'dead_letter',
      errorCode: 'EXPORT_FAILED',
    });
    expect(await exporter.getJob(job.id, actor)).toMatchObject({
      status: 'failed',
      errorSummary: 'EXPORT_FAILED',
    });
    await expect(exporter.schedule({ ...range, format: 'csv' }, actor)).resolves.toBeDefined();
  });

  it('fails the job when every earlier attempt died without reporting', async () => {
    await seed(1);
    const actor = analyst();
    const exporter = service();
    const job = await exporter.schedule({ ...range, format: 'csv' }, actor);
    await jobs.update(job.id, { status: 'running' });

    expect(await exporter.execute(job.id, { ...context, attempt: 6 })).toEqual({
      outcome: 'dead_letter',
      errorCode: 'REPORT_WORKER_ABANDONED',
    });
    expect(await exporter.getJob(job.id, actor)).toMatchObject({
      status: 'failed',
      errorSummary: 'REPORT_WORKER_ABANDONED',
    });
  });

  describe('artifact authorization', () => {
    async function completedJob(actor: Actor) {
      await seed(1);
      const exporter = service();
      const job = await exporter.schedule({ ...range, format: 'csv' }, actor);
      await exporter.execute(job.id, context);
      return job;
    }

    it('refuses another requester and lets an administrator in', async () => {
      const owner = analyst();
      const job = await completedJob(owner);

      await expect(artifacts.openAuthorized(job.id, analyst())).rejects.toMatchObject({
        status: 403,
      });
      await expect(service().getJob(job.id, analyst())).rejects.toMatchObject({ status: 403 });
      const admin: Actor = { ...analyst(), roles: ['integration_admin'] };
      const opened = await artifacts.openAuthorized(job.id, admin);
      opened.stream.destroy();
      expect(opened.size).toBeGreaterThan(0);
    });

    it('answers 404 for an unknown job and 410 once the artifact expired', async () => {
      const owner = analyst();
      const job = await completedJob(owner);

      await expect(artifacts.openAuthorized(randomUUID(), owner)).rejects.toMatchObject({
        status: 404,
      });
      await infrastructure.database.dataSource
        .getRepository(ReportJobEntity)
        .update(job.id, { expiresAt: new Date(Date.now() - 1_000) });
      await expect(artifacts.openAuthorized(job.id, owner)).rejects.toMatchObject({ status: 410 });
    });

    it.each(['../outside.csv', '/etc/passwd', 'exports/../../outside.csv', 'tmp/x.part'])(
      'rejects the stored path %s',
      async (artifactPath) => {
        const owner = analyst();
        const job = await completedJob(owner);
        await writeFile(join(root, '..', 'outside.csv'), 'secret').catch(() => undefined);
        await infrastructure.database.dataSource
          .getRepository(ReportJobEntity)
          .update(job.id, { artifactPath });

        await expect(artifacts.openAuthorized(job.id, owner)).rejects.toMatchObject({
          status: 403,
        });
        await rm(join(root, '..', 'outside.csv'), { force: true });
      },
    );

    it('stores artifacts under generated names outside the public directory', async () => {
      const job = await completedJob(analyst());
      const stored = await jobs.findById(job.id);

      expect(stored?.artifactPath).toMatch(new RegExp(`^exports/${job.id}/[0-9a-f-]{36}\\.csv$`));
      expect(root).not.toContain('public');
      expect(stored?.artifactHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await readFile(join(root, stored?.artifactPath as string))).length).toBeGreaterThan(
        0,
      );
    });
  });
});
