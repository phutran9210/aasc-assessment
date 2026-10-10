import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { WebhookEventRepository } from '@core/queue/repositories/webhook-event.repository.js';
import type { OperationContext } from '@core/queue/types/worker.types.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { AuditEventRepository } from '@modules/crm-integration/repositories/audit-event.repository.js';
import { ConfigurationRepository } from '@modules/crm-integration/repositories/configuration.repository.js';
import { LeadIdentityRepository } from '@modules/crm-integration/repositories/lead-identity.repository.js';
import { LeadRepository } from '@modules/crm-integration/repositories/lead.repository.js';
import { SubmissionRepository } from '@modules/crm-integration/repositories/submission.repository.js';
import { LeadIngestService } from '@modules/crm-integration/services/lead-ingest.service.js';
import type { Actor } from '@modules/integration-auth/types/index.js';
import { AnalyticsRevisionRepository } from '@modules/integration-analytics/repositories/analytics-revision.repository.js';
import { AnalyticsRepository } from '@modules/integration-analytics/repositories/analytics.repository.js';
import { CampaignCostRepository } from '@modules/integration-analytics/repositories/campaign-cost.repository.js';
import { CampaignCostService } from '@modules/integration-analytics/services/campaign-cost.service.js';
import { ScoreRecomputeService } from '@modules/integration-analytics/services/score-recompute.service.js';
import { CampaignDailyEntity } from '@modules/integration-analytics/entities/campaign-daily.entity.js';
import { ReportJobEntity } from '@modules/integration-reports/entities/report-job.entity.js';
import { ReportRowErrorEntity } from '@modules/integration-reports/entities/report-row-error.entity.js';
import { ReportJobRepository } from '@modules/integration-reports/repositories/report-job.repository.js';
import { ReportRowErrorRepository } from '@modules/integration-reports/repositories/report-row-error.repository.js';
import { ArtifactService } from '@modules/integration-reports/services/artifact.service.js';
import { CampaignCostImportService } from '@modules/integration-reports/services/campaign-cost-import.service.js';
import {
  ImportJobSupport,
  MAX_IMPORT_BYTES,
} from '@modules/integration-reports/services/import-job.support.js';
import { LeadImportService } from '@modules/integration-reports/services/lead-import.service.js';
import { ImportHandler } from '@modules/integration-reports/workers/import.handler.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const ADVERTISER = 'advertiser-import';
const LEAD_HEADER = 'advertiser_id,source_record_id,occurred_at,full_name,email,phone,campaign_id';

function operator(): Actor {
  return {
    sub: randomUUID(),
    sid: randomUUID(),
    username: 'operator',
    roles: ['integration_operator'],
  };
}

function context(): OperationContext {
  return {
    operationId: randomUUID(),
    ownerToken: randomUUID(),
    attempt: 1,
    revisions: {},
    signal: new AbortController().signal,
    assertOwnership: () => Promise.resolve(),
    acquireAggregateLease: () => Promise.resolve(null),
    releaseAggregateLease: () => Promise.resolve(true),
  };
}

function leadRow(index: number, patch: Partial<Record<string, string>> = {}): string {
  const row = {
    advertiser_id: ADVERTISER,
    source_record_id: `src-${index}`,
    occurred_at: '2026-06-01T03:00:00Z',
    full_name: `Lead ${index}`,
    email: `lead-${index}@example.test`,
    phone: '',
    campaign_id: 'cmp-history',
    ...patch,
  };
  return LEAD_HEADER.split(',')
    .map((key) => row[key as keyof typeof row])
    .join(',');
}

describe('historical imports', () => {
  let infrastructure: TestInfrastructure;
  let root: string;
  let artifacts: ArtifactService;
  let jobs: ReportJobRepository;
  let ingest: LeadIngestService;
  let leadImports: LeadImportService;
  let costImports: CampaignCostImportService;
  let costs: CampaignCostService;
  let handler: ImportHandler;
  const bitrixStore = new BitrixStore();
  const tiktokStore = new TiktokStore();

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    root = await mkdtemp(join(tmpdir(), 'aasc-import-'));
    const dataSource = infrastructure.database.dataSource;
    const operations = new OperationRepository();
    const outbox = new OutboxRepository();
    const revisions = new AnalyticsRevisionRepository();
    jobs = new ReportJobRepository(dataSource);
    artifacts = new ArtifactService(root, jobs);
    const rowErrors = new ReportRowErrorRepository(dataSource);
    const support = new ImportJobSupport(
      dataSource,
      jobs,
      rowErrors,
      artifacts,
      operations,
      outbox,
    );
    ingest = new LeadIngestService(
      dataSource,
      new LeadRepository(),
      new LeadIdentityRepository(),
      new SubmissionRepository(),
      operations,
      outbox,
      new WebhookEventRepository(),
      new ConfigurationRepository(dataSource),
      revisions,
      'import-portal',
      'VN',
    );
    costs = new CampaignCostService(new CampaignCostRepository(), revisions);
    const scope = {
      advertiserId: ADVERTISER,
      tiktokMode: 'mock' as const,
      reportTimezone: 'Asia/Ho_Chi_Minh',
      defaultPhoneRegion: 'VN',
    };
    leadImports = new LeadImportService(
      dataSource,
      support,
      new WebhookEventRepository(),
      ingest,
      new ConfigurationRepository(dataSource),
      new LeadIdentityRepository(),
      new AuditEventRepository(),
      scope,
    );
    costImports = new CampaignCostImportService(dataSource, support, costs, scope);
    handler = new ImportHandler(dataSource, jobs, leadImports, costImports);
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
        'integration_lead_identity',
        'integration_submission',
        'integration_lead',
        'integration_webhook_event',
        'integration_campaign_daily',
        'integration_audit_event',
        'integration_outbox',
        'integration_operation',
      ]
        .map((table) => `"${schema}"."${table}"`)
        .join(', ')} CASCADE`,
    );
    jest.restoreAllMocks();
  });

  async function upload(content: string | Buffer, name = 'leads.csv') {
    const path = await artifacts.createUploadPath();
    await writeFile(path, content);
    const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content);
    return { path, originalName: name, size };
  }

  const count = (
    entity: Parameters<TestInfrastructure['database']['dataSource']['getRepository']>[0],
  ) => infrastructure.database.dataSource.getRepository(entity).count();
  const job = (id: string) =>
    infrastructure.database.dataSource.getRepository(ReportJobEntity).findOneByOrFail({ id });
  const errors = async (jobId: string) =>
    (
      await infrastructure.database.dataSource
        .getRepository(ReportRowErrorEntity)
        .find({ where: { reportJobId: jobId }, order: { rowNumber: 'ASC' } })
    ).map((error) => [error.rowNumber, error.errorCode, error.sourceKey]);

  async function runLeads(jobId: string, limit = 200) {
    let cursor = 0;
    for (;;) {
      const result = await leadImports.processChunk(jobId, cursor, limit, context());
      if (result.done) return result;
      cursor = result.nextCursor;
    }
  }

  it('accepts a file of exactly 10 MiB and refuses one byte more before parsing', async () => {
    const head = `${LEAD_HEADER}\n${ADVERTISER},src-big,2026-06-01T03:00:00Z,`;
    const tail = ',big@example.test,,cmp\n';
    const padding = 'x'.repeat(MAX_IMPORT_BYTES - Buffer.byteLength(head + tail));
    const exact = await upload(head + padding + tail);
    expect(exact.size).toBe(10 * 1024 * 1024);

    await expect(leadImports.start(exact, {}, operator())).resolves.toMatchObject({
      kind: 'import',
      status: 'pending',
      totalRows: 1,
    });

    const over = await upload(head + padding + 'y' + tail);
    await expect(leadImports.start(over, {}, operator())).rejects.toMatchObject({ status: 413 });
    expect(existsSync(over.path)).toBe(false);
    expect(await count(ReportJobEntity)).toBe(1);
  });

  it('rejects duplicate headers and unsupported files without creating a job', async () => {
    const duplicated = await upload(`${LEAD_HEADER},email\n${leadRow(1)},x\n`);
    await expect(leadImports.start(duplicated, {}, operator())).rejects.toMatchObject({
      status: 400,
    });
    const executable = await upload('MZ', 'leads.exe');
    await expect(leadImports.start(executable, {}, operator())).rejects.toMatchObject({
      status: 400,
    });

    expect(await count(ReportJobEntity)).toBe(0);
    expect(existsSync(duplicated.path)).toBe(false);
    expect(existsSync(executable.path)).toBe(false);
  });

  it('stores the upload under a generated name with its checksum and queues one operation', async () => {
    const content = `${LEAD_HEADER}\n${leadRow(1)}\n`;
    const file = await upload(content, '../../etc/passwd.csv');

    const created = await leadImports.start(file, {}, operator());
    const stored = await jobs.findById(created.id);

    expect(stored?.artifactPath).toMatch(new RegExp(`^imports/${created.id}/[0-9a-f-]{36}\\.csv$`));
    expect(stored?.artifactHash).toBe(createHash('sha256').update(content).digest('hex'));
    expect(await readFile(join(root, stored?.artifactPath as string), 'utf8')).toBe(content);
    expect(existsSync(file.path)).toBe(false);
    expect(created.filters).toMatchObject({
      type: 'leads',
      format: 'csv',
      dryRun: true,
      applyRules: false,
      sendFeedback: false,
    });
    expect(JSON.stringify(created.filters)).not.toContain('passwd');
    expect(
      await infrastructure.database.dataSource
        .getRepository(OperationEntity)
        .findOneByOrFail({ operationKey: `lead-import/${created.id}` }),
    ).toMatchObject({ kind: 'historical_lead_import', aggregateId: created.id });
  });

  it('validates and previews a dry run without creating leads, events or remote calls', async () => {
    const file = await upload(
      [LEAD_HEADER, leadRow(1), leadRow(2, { email: '', phone: '' }), leadRow(3)].join('\n'),
    );
    const created = await leadImports.start(file, {}, operator());

    const result = await runLeads(created.id);

    expect(result).toMatchObject({ done: true, succeeded: 2, failed: 1 });
    expect(await job(created.id)).toMatchObject({
      status: 'completed',
      totalRows: 3,
      successRows: 2,
      failedRows: 1,
      filters: expect.objectContaining({ preview: { create: 2, merge: 0, noop: 0 } }),
    });
    expect(await errors(created.id)).toEqual([[2, 'CONTACT_IDENTIFIER_MISSING', 'src-2']]);
    expect(await count(LeadEntity)).toBe(0);
    expect(await count(SubmissionEntity)).toBe(0);
    expect(await count(WebhookEventEntity)).toBe(0);
    expect(bitrixStore.calls).toHaveLength(0);
    expect(tiktokStore.calls).toHaveLength(0);
    expect(
      (await infrastructure.database.dataSource.getRepository(OperationEntity).find()).map(
        (operation) => operation.kind,
      ),
    ).toEqual(['historical_lead_import']);
  });

  it('imports live rows as historical submissions that keep rules and feedback off', async () => {
    const file = await upload([LEAD_HEADER, leadRow(1), leadRow(2)].join('\n'));
    const created = await leadImports.start(file, { dryRun: false }, operator());

    await runLeads(created.id);

    const submissions = await infrastructure.database.dataSource
      .getRepository(SubmissionEntity)
      .find();
    expect(submissions).toHaveLength(2);
    for (const submission of submissions) {
      expect(submission).toMatchObject({
        isHistorical: true,
        applyRules: false,
        sendFeedback: false,
        campaignId: 'cmp-history',
      });
    }
    const leads = await infrastructure.database.dataSource.getRepository(LeadEntity).find();
    expect(leads.map((lead) => lead.firstTouchAt.toISOString())).toEqual([
      '2026-06-01T03:00:00.000Z',
      '2026-06-01T03:00:00.000Z',
    ]);
    expect(await job(created.id)).toMatchObject({ status: 'completed', successRows: 2 });

    const dataSource = infrastructure.database.dataSource;
    await new ScoreRecomputeService(
      dataSource,
      new AnalyticsRepository(dataSource),
      new LeadRepository(),
      new SubmissionRepository(),
      new ConfigurationRepository(dataSource),
      new OperationRepository(),
      new OutboxRepository(),
      new AnalyticsRevisionRepository(),
    ).run(new Date().toISOString());
    const kinds = (await dataSource.getRepository(OperationEntity).find()).map(
      (operation) => operation.kind,
    );
    expect(kinds).not.toContain('bitrix_deal_convert');
    expect(kinds).not.toContain('tiktok_feedback');
    expect(kinds.filter((kind) => kind === 'bitrix_lead_sync')).toHaveLength(2);
    expect(await count(AuditEventEntity)).toBe(1);
  });

  it('audits an import that explicitly enables rules and feedback', async () => {
    const file = await upload([LEAD_HEADER, leadRow(1)].join('\n'));
    const actor = operator();

    const created = await leadImports.start(
      file,
      { dryRun: false, applyRules: true, sendFeedback: true },
      actor,
    );
    await runLeads(created.id);

    expect(await infrastructure.database.dataSource.getRepository(AuditEventEntity).find()).toEqual(
      [
        expect.objectContaining({
          actorId: actor.sub,
          eventType: 'import.leads.started',
          aggregateId: created.id,
          metadata: expect.objectContaining({
            applyRules: true,
            sendFeedback: true,
            dryRun: false,
          }),
        }),
      ],
    );
    expect(await infrastructure.database.dataSource.getRepository(SubmissionEntity).find()).toEqual(
      [expect.objectContaining({ applyRules: true, sendFeedback: true, isHistorical: true })],
    );
  });

  it('reports row problems without losing the valid rows around them', async () => {
    const file = await upload(
      '﻿' +
        [
          LEAD_HEADER,
          leadRow(1, { full_name: '"Lê, Minh\nChâu"' }),
          leadRow(2, { source_record_id: '' }),
          leadRow(1, { email: 'other@example.test' }),
          leadRow(4, { advertiser_id: 'someone-else' }),
          leadRow(5, { occurred_at: '01/06/2026' }),
          leadRow(6, { occurred_at: '2999-01-01T00:00:00Z' }),
          `${ADVERTISER},src-7,2026-06-01T03:00:00Z,"never closed`,
        ].join('\r\n'),
    );
    const created = await leadImports.start(file, { dryRun: false }, operator());

    await runLeads(created.id);

    expect(await errors(created.id)).toEqual([
      [2, 'SOURCE_RECORD_ID_MISSING', null],
      [3, 'DUPLICATE_SOURCE_RECORD_ID', 'src-1'],
      [4, 'ADVERTISER_MISMATCH', 'src-4'],
      [5, 'OCCURRED_AT_INVALID', 'src-5'],
      [6, 'OCCURRED_AT_INVALID', 'src-6'],
      [7, 'ROW_MALFORMED', null],
    ]);
    expect(await job(created.id)).toMatchObject({ totalRows: 7, successRows: 1, failedRows: 6 });
    const [lead] = await infrastructure.database.dataSource.getRepository(LeadEntity).find();
    // The quoted line break stayed inside one field; name normalization folds it to a space.
    expect(lead.name).toBe('Lê, Minh Châu');
    expect(
      JSON.stringify(
        await infrastructure.database.dataSource.getRepository(ReportRowErrorEntity).find(),
      ),
    ).not.toContain('example.test');
  });

  it('resumes after a crash on row 199 of 200 without duplicating leads', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => leadRow(index + 1));
    const file = await upload([LEAD_HEADER, ...rows].join('\n'));
    const created = await leadImports.start(file, { dryRun: false }, operator());
    const original = ingest.process.bind(ingest);
    let calls = 0;
    jest.spyOn(ingest, 'process').mockImplementation((...args) => {
      calls += 1;
      if (calls === 199) return Promise.reject(new Error('worker killed'));
      return original(...args);
    });

    await expect(leadImports.processChunk(created.id, 0, 200, context())).rejects.toThrow(
      'worker killed',
    );
    expect(await job(created.id)).toMatchObject({ cursor: null, successRows: 0 });
    expect(await count(LeadEntity)).toBe(198);

    const result = await leadImports.processChunk(created.id, 0, 200, context());

    expect(result).toMatchObject({ done: true, nextCursor: 200, succeeded: 200, failed: 0 });
    expect(await count(LeadEntity)).toBe(200);
    expect(await count(SubmissionEntity)).toBe(200);
    expect(await job(created.id)).toMatchObject({
      status: 'completed',
      cursor: '200',
      successRows: 200,
      failedRows: 0,
    });
  });

  it('checkpoints after every chunk and ignores a replayed chunk', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => leadRow(index + 1));
    const created = await leadImports.start(
      await upload([LEAD_HEADER, ...rows].join('\n')),
      { dryRun: false },
      operator(),
    );

    const first = await leadImports.processChunk(created.id, 0, 2, context());
    expect(first).toMatchObject({ done: false, nextCursor: 2, succeeded: 2 });
    expect(await job(created.id)).toMatchObject({ cursor: '2', successRows: 2, status: 'running' });

    await leadImports.processChunk(created.id, 0, 2, context());
    expect(await job(created.id)).toMatchObject({ cursor: '2', successRows: 2 });
    await runLeads(created.id, 2);
    expect(await job(created.id)).toMatchObject({
      cursor: '5',
      successRows: 5,
      status: 'completed',
    });
    expect(await count(LeadEntity)).toBe(5);
  });

  it('treats the same source record as a no-op and a changed one as a conflict', async () => {
    const first = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1), leadRow(2)].join('\n')),
      { dryRun: false },
      operator(),
    );
    await runLeads(first.id);

    const again = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1), leadRow(2, { full_name: 'Someone Else' })].join('\n')),
      { dryRun: false },
      operator(),
    );
    await runLeads(again.id);

    expect(await job(again.id)).toMatchObject({ successRows: 1, failedRows: 1 });
    expect(await errors(again.id)).toEqual([[2, 'SOURCE_RECORD_CONTENT_CONFLICT', 'src-2']]);
    expect(await count(LeadEntity)).toBe(2);
    expect(await count(SubmissionEntity)).toBe(2);
    const names = (await infrastructure.database.dataSource.getRepository(LeadEntity).find()).map(
      (lead) => lead.name,
    );
    expect(names.sort()).toEqual(['Lead 1', 'Lead 2']);

    const preview = await leadImports.start(
      await upload(
        [LEAD_HEADER, leadRow(1), leadRow(3, { email: 'lead-2@example.test' }), leadRow(4)].join(
          '\n',
        ),
      ),
      {},
      operator(),
    );
    await runLeads(preview.id);
    expect((await job(preview.id)).filters).toMatchObject({
      preview: { create: 1, merge: 1, noop: 1 },
    });
  });

  it('refuses to process a stored file whose checksum no longer matches', async () => {
    const created = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1)].join('\n')),
      { dryRun: false },
      operator(),
    );
    const stored = await jobs.findById(created.id);
    await appendFile(join(root, stored?.artifactPath as string), `\n${leadRow(9)}`);

    await expect(leadImports.processChunk(created.id, 0, 200, context())).rejects.toThrow(
      /checksum/i,
    );
    expect(await count(LeadEntity)).toBe(0);
  });

  it('imports campaign costs with exact decimals and keeps a missing day missing', async () => {
    const file = await upload(
      [
        'advertiser_id,campaign_id,date,currency,spend,impressions,clicks',
        `${ADVERTISER},cmp-1,2026-07-01,vnd,350000.5,1200,34`,
        `${ADVERTISER},cmp-1,2026-07-03,VND,9999999999999999.9999,,`,
        `${ADVERTISER},cmp-1,2026-07-04,VND,1.00001,,`,
        `${ADVERTISER},cmp-1,2026-02-30,VND,1,,`,
        `${ADVERTISER},cmp-1,2026-07-05,DONG,1,,`,
        `someone-else,cmp-1,2026-07-06,VND,1,,`,
        `${ADVERTISER},cmp-1,2026-07-07,VND,-5,,`,
      ].join('\n'),
      'costs.csv',
    );
    const created = await costImports.start(file, operator());
    const revision = () => new AnalyticsRepository(infrastructure.database.dataSource).revision();
    const before = BigInt(await revision());

    const result = await costImports.processChunk(created.id, 0);

    expect(result).toMatchObject({ done: true, succeeded: 2, failed: 5 });
    expect(await errors(created.id)).toEqual([
      [3, 'COST_INVALID_AMOUNT', 'cmp-1/2026-07-04/VND'],
      [4, 'COST_INVALID_DATE', 'cmp-1/2026-02-30/VND'],
      [5, 'COST_INVALID_CURRENCY', 'cmp-1/2026-07-05/DONG'],
      [6, 'ADVERTISER_MISMATCH', 'cmp-1/2026-07-06/VND'],
      [7, 'COST_INVALID_AMOUNT', 'cmp-1/2026-07-07/VND'],
    ]);
    const rows = await infrastructure.database.dataSource
      .getRepository(CampaignDailyEntity)
      .find({ order: { reportDate: 'ASC' } });
    expect(
      rows.map((row) => [row.reportDate, row.spend, row.source, row.reportingTimezone]),
    ).toEqual([
      ['2026-07-01', '350000.5000', 'import', 'Asia/Ho_Chi_Minh'],
      ['2026-07-03', '9999999999999999.9999', 'import', 'Asia/Ho_Chi_Minh'],
    ]);
    expect(BigInt(await revision())).toBe(before + 1n);
    const [group] = await costs.summarize(
      {
        advertiserId: ADVERTISER,
        campaignIds: ['cmp-1'],
        fromDate: '2026-07-01',
        toDate: '2026-07-04',
      },
      infrastructure.database.dataSource.manager,
    );
    expect(group).toMatchObject({ coveredDays: 2, requestedDays: 3, spendComplete: false });

    await costImports.processChunk(created.id, 0);
    expect(await job(created.id)).toMatchObject({
      successRows: 2,
      failedRows: 5,
      status: 'completed',
    });
    expect(BigInt(await revision())).toBe(before + 1n);
  });

  it('runs both import kinds to completion through the worker handler', async () => {
    const leadJob = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1), leadRow(2), leadRow(3)].join('\n')),
      { dryRun: false },
      operator(),
    );
    const costJob = await costImports.start(
      await upload(
        `advertiser_id,campaign_id,date,currency,spend\n${ADVERTISER},cmp-1,2026-07-01,VND,10\n`,
        'costs.csv',
      ),
      operator(),
    );
    const operationFor = async (key: string) =>
      (
        await infrastructure.database.dataSource
          .getRepository(OperationEntity)
          .findOneByOrFail({ operationKey: key })
      ).id;

    expect(
      await handler.handle({
        ...context(),
        operationId: await operationFor(`lead-import/${leadJob.id}`),
      }),
    ).toEqual({ outcome: 'succeeded' });
    expect(
      await handler.handle({
        ...context(),
        operationId: await operationFor(`cost-import/${costJob.id}`),
      }),
    ).toEqual({ outcome: 'succeeded' });
    expect(await handler.handle(context())).toMatchObject({ outcome: 'quarantined' });

    expect(await job(leadJob.id)).toMatchObject({ status: 'completed', successRows: 3 });
    expect(await job(costJob.id)).toMatchObject({ status: 'completed', successRows: 1 });
    expect(await count(LeadEntity)).toBe(3);
  });

  it('retries a failing import and marks the job failed on the last attempt', async () => {
    const created = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1)].join('\n')),
      { dryRun: false },
      operator(),
    );
    const operationId = (
      await infrastructure.database.dataSource
        .getRepository(OperationEntity)
        .findOneByOrFail({ operationKey: `lead-import/${created.id}` })
    ).id;
    jest.spyOn(ingest, 'process').mockRejectedValue(new Error('database down'));

    expect(await handler.handle({ ...context(), operationId, attempt: 1 })).toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'IMPORT_FAILED',
    });
    expect(await handler.handle({ ...context(), operationId, attempt: 5 })).toMatchObject({
      outcome: 'dead_letter',
      errorCode: 'IMPORT_FAILED',
    });
    expect(await job(created.id)).toMatchObject({
      status: 'failed',
      errorSummary: 'IMPORT_FAILED',
    });
  });

  it('fails the job when every earlier attempt died without reporting', async () => {
    const created = await leadImports.start(
      await upload([LEAD_HEADER, leadRow(1)].join('\n')),
      { dryRun: false },
      operator(),
    );
    const operationId = (
      await infrastructure.database.dataSource
        .getRepository(OperationEntity)
        .findOneByOrFail({ operationKey: `lead-import/${created.id}` })
    ).id;

    expect(await handler.handle({ ...context(), operationId, attempt: 6 })).toEqual({
      outcome: 'dead_letter',
      errorCode: 'REPORT_WORKER_ABANDONED',
    });
    expect(await job(created.id)).toMatchObject({
      status: 'failed',
      errorSummary: 'REPORT_WORKER_ABANDONED',
    });
    expect(await count(LeadEntity)).toBe(0);
  });
});
