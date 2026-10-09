import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { DEMO_CAMPAIGN_ID, seedDemo } from '@/apps/tiktok/database/seed.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { SubmissionEntity } from '@modules/crm-integration/entities/submission.entity.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const ADVERTISER = 'mock-advertiser';
const WEBHOOK_SECRET = 'acceptance-webhook-secret-value';

type Evidence = [file: string, title: string];

/**
 * Where each acceptance criterion of the specification is proven. The criteria are exercised by
 * the task-level suites; this table is checked below so it cannot point at a test that no longer
 * exists, and the scenarios after it re-run the cross-cutting ones on the fully composed stack.
 */
const ACCEPTANCE: Record<string, Evidence[]> = {
  AC01: [
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'stores the exact signed bytes and commits event, operation, and outbox before ACK',
    ],
  ],
  AC02: [
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'returns 401 for bad or duplicate signature fields and 400 for excessive JSON depth',
    ],
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'accepts a 256 KiB body and returns 413 for one byte more',
    ],
  ],
  AC03: [
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'returns one non-duplicate receipt for concurrent deliveries of the same event',
    ],
    ['test/tiktok/acceptance.e2e-spec.ts', 'creates one remote lead from 20 parallel deliveries'],
  ],
  AC04: [
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'persists unsupported authenticated events as ignored without dispatching work',
    ],
    [
      'test/tiktok/lead-ingest.integration-spec.ts',
      'keeps form events pending and links them when the lead becomes known',
    ],
  ],
  AC05: [
    [
      'src/modules/crm-integration/__tests__/normalize-lead.spec.ts',
      'normalizes Vietnamese contacts, Unicode text, and preserves source identifiers and answers',
    ],
    [
      'src/modules/crm-integration/__tests__/normalize-lead.spec.ts',
      'drops one invalid contact when the other identity is valid and quarantines when neither is valid',
    ],
  ],
  AC06: [
    [
      'test/tiktok/lead-ingest.integration-spec.ts',
      'deduplicates concurrent events by email and phone while retaining every submission',
    ],
  ],
  AC07: [
    [
      'test/tiktok/lead-ingest.integration-spec.ts',
      'quarantines cross-lead email and phone matches without transferring either identity',
    ],
  ],
  AC08: [
    [
      'src/modules/crm-integration/__tests__/merge-lead.spec.ts',
      'orders updates by occurredAt and resolves equal timestamps by eventKey',
    ],
    [
      'src/modules/crm-integration/__tests__/crm-lead-diff.spec.ts',
      'does not overwrite a remote field changed since the integration last wrote it',
    ],
    [
      'test/tiktok/lead-sync.integration-spec.ts',
      'runs version 2 first and prevents a later version 1 operation from overwriting it',
    ],
  ],
  AC09: [
    [
      'src/modules/crm-integration/__tests__/mapping-compiler.spec.ts',
      'compiles name, email/phone multifields, and custom fields with explicit ownership',
    ],
    [
      'test/tiktok/configuration.e2e-spec.ts',
      'does not advance the active revision when CRM metadata validation fails',
    ],
  ],
  AC10: [
    [
      'src/modules/crm-integration/__tests__/crm-lead-diff.spec.ts',
      'preserves remote-added multifields and their IDs while appending mapped values',
    ],
    [
      'src/modules/crm-integration/__tests__/crm-lead-diff.spec.ts',
      'returns no patch for null, empty, or already-synchronized values',
    ],
  ],
  AC11: [
    [
      'test/tiktok/lead-sync.integration-spec.ts',
      'finds a lead persisted before a create timeout and never creates it twice',
    ],
    [
      'test/tiktok/acceptance.e2e-spec.ts',
      'reconciles a create whose response was lost instead of creating the lead twice',
    ],
  ],
  AC12: [
    [
      'test/tiktok/lead-sync.integration-spec.ts',
      'reconciles timeline comments after a persist-then-timeout without posting twice',
    ],
  ],
  AC13: [
    [
      'src/modules/crm-integration/__tests__/rule-engine.spec.ts',
      'matches contains case-insensitively and selects the first priority/id rule',
    ],
    [
      'src/modules/crm-integration/__tests__/rule-engine.spec.ts',
      'rejects unknown paths, excessive nesting, predicate counts, and executable expressions',
    ],
  ],
  AC14: [
    [
      'test/tiktok/conversion.integration-spec.ts',
      'uses one conversion operation and advances round-robin once for concurrent auto and manual requests',
    ],
    [
      'test/tiktok/conversion.e2e-spec.ts',
      'returns 200 with the remote deal when the conversion saga is already complete',
    ],
  ],
  AC15: [
    [
      'test/tiktok/conversion.integration-spec.ts',
      'retries Lead completion without creating a second deal and preserves the assignment snapshot',
    ],
    [
      'test/tiktok/conversion.integration-spec.ts',
      'rejects an invalid pipeline or inactive selected assignee without creating a remote deal',
    ],
  ],
  AC16: [
    [
      'test/tiktok/deal-events.integration-spec.ts',
      'records reopen and second win as distinct observed history without counting revenue twice',
    ],
    [
      'test/tiktok/scheduler.integration-spec.ts',
      'records conversion milestones once while still scheduling feedback',
    ],
  ],
  AC17: [
    [
      'test/tiktok/analytics.integration-spec.ts',
      'reports 40/20/50 for ten leads, four converted and two won',
    ],
    [
      'test/tiktok/analytics.integration-spec.ts',
      'does not multiply counts or revenue by repeated submissions and deal history',
    ],
  ],
  AC18: [
    [
      'test/tiktok/analytics.e2e-spec.ts',
      'returns CPL 100000, ROI 200 and ROAS 3 for the acceptance cohort',
    ],
    [
      'test/tiktok/analytics.integration-spec.ts',
      'withholds ratios when a cost day or a won amount is missing',
    ],
  ],
  AC19: [
    [
      'src/modules/crm-integration/__tests__/lead-score.spec.ts',
      'counts each interaction event once and excludes events older than 30 days',
    ],
    [
      'test/tiktok/score-recompute.integration-spec.ts',
      'drops interactions that left the 30 day window and queues one lead sync',
    ],
    [
      'test/tiktok/analytics.integration-spec.ts',
      'keeps serving the cached response until the revision changes',
    ],
  ],
  AC20: [
    [
      'test/tiktok/export.integration-spec.ts',
      'writes CSV with a BOM, neutralized formulas and phone numbers kept as text',
    ],
    [
      'test/tiktok/export.integration-spec.ts',
      'writes XLSX with phone numbers and identifiers typed as text',
    ],
    [
      'test/tiktok/export.integration-spec.ts',
      'refuses a synchronous export above the row limit with EXPORT_REQUIRES_ASYNC',
    ],
    [
      'test/tiktok/export.integration-spec.ts',
      'refuses another requester and lets an administrator in',
    ],
  ],
  AC21: [
    [
      'test/tiktok/feedback.integration-spec.ts',
      'records missing or false consent as skipped and makes zero provider calls',
    ],
    [
      'test/tiktok/feedback.integration-spec.ts',
      'retains rejected event errors and retries with the same remote event ID',
    ],
  ],
  AC22: [
    [
      'test/tiktok/import.integration-spec.ts',
      'validates and previews a dry run without creating leads, events or remote calls',
    ],
    [
      'test/tiktok/import.integration-spec.ts',
      'resumes after a crash on row 199 of 200 without duplicating leads',
    ],
  ],
  AC23: [
    [
      'test/tiktok/scheduler.integration-spec.ts',
      'creates one job for the previous day when two schedulers tick together',
    ],
    [
      'test/tiktok/scheduler.integration-spec.ts',
      'raises one dead-letter alert per 30 minute window and one recovery',
    ],
  ],
  AC24: [
    [
      'test/tiktok/demo.e2e-spec.ts',
      'describes every route in an OpenAPI document without leaking configuration',
    ],
    [
      'test/tiktok/configuration.e2e-spec.ts',
      'requires an admin and If-Match, then returns the mapping revision and ETag',
    ],
    [
      'test/tiktok/auth.e2e-spec.ts',
      'logs in, authorizes the current role, denies missing roles and rejects AASC JWTs',
    ],
    [
      'test/tiktok/management.e2e-spec.ts',
      'rejects limits above 100 and denies read access to roles without lead permission',
    ],
  ],
  AC25: [
    [
      'test/tiktok/demo.e2e-spec.ts',
      'creates the demo identity, users, rules and costs, and is repeatable',
    ],
    [
      'src/apps/tiktok/__tests__/app-boundary.spec.ts',
      'load without evaluating the legacy application configuration',
    ],
    [
      'test/tiktok/acceptance.e2e-spec.ts',
      'serves the legacy SQLite app and the PostgreSQL app side by side',
    ],
  ],
  AC26: [
    [
      'test/tiktok/tiktok-webhook.e2e-spec.ts',
      'durably ACKs while the app Redis clients are disconnected',
    ],
    [
      'test/tiktok/worker-recovery.integration-spec.ts',
      'recreates a durable queue generation when a published Redis job has gone missing',
    ],
    [
      'test/tiktok/worker-recovery.integration-spec.ts',
      'does not rerun a succeeded operation when a deleted or replayed job is delivered',
    ],
  ],
  AC27: [
    [
      'src/core/queue/__tests__/retry-policy.spec.ts',
      'honors Retry-After as a lower bound for a rate limit response',
    ],
    [
      'test/tiktok/worker-recovery.integration-spec.ts',
      'persists retry generations and sends the fifth transient failure to the DLQ',
    ],
    [
      'test/tiktok/management.e2e-spec.ts',
      'rejects retry while active and keeps attempt/config history when retrying a dead letter',
    ],
  ],
  AC28: [
    [
      'test/tiktok/auth.e2e-spec.ts',
      'revokes and replays sessions, and returns 204 for repeated logout',
    ],
    ['test/tiktok/auth.e2e-spec.ts', 'returns 503 when Redis session services are unavailable'],
    [
      'test/tiktok/health-security.e2e-spec.ts',
      'limits a user to 30 mutations per minute with Retry-After, reads stay available',
    ],
  ],
  AC29: [
    ['test/tiktok/health-security.e2e-spec.ts', 'is not ready, and says which dependency failed'],
    [
      'test/tiktok/operations.integration-spec.ts',
      'treats a worker heartbeat older than 30 seconds as stale',
    ],
    [
      'test/tiktok/worker-recovery.integration-spec.ts',
      'boots and shuts down the isolated worker module against test PostgreSQL and Redis',
    ],
  ],
  AC30: [
    ['test/tiktok/jest-coverage.config.mjs', 'coverageThreshold'],
    ['test/tiktok/acceptance.e2e-spec.ts', 'has evidence for every acceptance criterion'],
  ],
};

function signed(app: INestApplication, payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return request(app.getHttpServer())
    .post('/webhooks/tiktok/leads')
    .set('Content-Type', 'application/json')
    .set('TikTok-Signature', `t=${timestamp},s=${digest}`)
    .send(body.toString('utf8'));
}

function leadEvent(eventId: string, email: string): Record<string, unknown> {
  return {
    event_id: eventId,
    event: 'lead.generate',
    advertiser_id: ADVERTISER,
    timestamp: new Date().toISOString(),
    campaign_id: DEMO_CAMPAIGN_ID,
    form_id: 'form-lead-v1',
    lead_data: { name: 'Acceptance Lead', email },
  };
}

describe('acceptance of the composed stack', () => {
  it('has evidence for every acceptance criterion', async () => {
    const expected = Array.from(
      { length: 30 },
      (_, index) => `AC${String(index + 1).padStart(2, '0')}`,
    );
    expect(Object.keys(ACCEPTANCE)).toEqual(expected);

    const sources = new Map<string, string>();
    for (const [criterion, evidence] of Object.entries(ACCEPTANCE)) {
      expect(evidence.length).toBeGreaterThan(0);
      for (const [file, title] of evidence) {
        if (!sources.has(file)) sources.set(file, await readFile(file, 'utf8'));
        expect([criterion, file, (sources.get(file) as string).includes(title)]).toEqual([
          criterion,
          file,
          true,
        ]);
      }
    }
  });

  describe('live scenarios', () => {
    let infrastructure: TestInfrastructure;
    let legacy: INestApplication;
    let legacyUrl: string;
    let crm: BitrixStore;
    let mock: ProviderServer;
    let api: TestApp;
    let worker: INestApplicationContext;
    let dataSource: DataSource;
    const previousEnv = new Map<string, string | undefined>();

    const setEnv = (values: Record<string, string>) => {
      for (const [key, value] of Object.entries(values)) {
        if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
        process.env[key] = value;
      }
    };
    const remoteLeadCreates = () =>
      crm.calls.filter(
        (call) => call.method === 'crm.item.add' && Number(call.payload.entityTypeId) === 1,
      );

    async function waitFor<T>(what: string, read: () => Promise<T | undefined>): Promise<T> {
      const deadline = Date.now() + 70_000;
      for (;;) {
        const value = await read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const syncedLead = (email: string) =>
      waitFor(`lead ${email} to be synchronized`, async () => {
        const lead = await dataSource.getRepository(LeadEntity).findOne({ where: { email } });
        return lead?.syncStatus === 'synced' && lead.bitrixLeadId ? lead : undefined;
      });

    beforeAll(async () => {
      // The legacy application first: its configuration only accepts its own environment.
      const legacyEnv = { ...process.env };
      await import('../setup-env.js');
      const { createListeningTestApp } = await import('../utils/create-test-app.js');
      ({ app: legacy, url: legacyUrl } = await createListeningTestApp());
      for (const key of Object.keys(process.env)) {
        if (!(key in legacyEnv)) delete process.env[key];
      }
      Object.assign(process.env, legacyEnv);

      infrastructure = await createTestInfrastructure();
      crm = new BitrixStore();
      mock = new ProviderServer({ bitrix: crm, tiktok: new TiktokStore() });
      await mock.listen();
      setEnv({
        TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
        TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
        TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
        INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
        TIKTOK_MODE: 'mock',
        BITRIX_INTEGRATION_MODE: 'mock',
        TIKTOK_ADVERTISER_ID: ADVERTISER,
        TIKTOK_WEBHOOK_SECRET: WEBHOOK_SECRET,
        BITRIX_PORTAL_KEY: 'mock-portal',
        BITRIX24_WEBHOOK_URL: mock.bitrixEndpoint,
        TIKTOK_MOCK_BASE_URL: mock.tiktokBaseUrl,
        TIKTOK_MOCK_API_KEY: 'mock-api-key',
      });
      await seedDemo(infrastructure.database.dataSource, validateTiktokEnv(process.env));

      const { TiktokApiModule } = await import('@/apps/tiktok/api.module.js');
      api = await createTestApp({}, TiktokApiModule.fromEnvironment());
      await api.app.listen(0, '127.0.0.1');
      dataSource = api.app.get<DataSource>(getDataSourceToken('tiktok'));
      const { TiktokWorkerModule } = await import('@/apps/tiktok/worker.module.js');
      worker = await NestFactory.createApplicationContext(TiktokWorkerModule, { logger: false });
    }, 60_000);

    afterAll(async () => {
      await worker?.close();
      await api?.close();
      await mock?.close();
      await legacy?.close();
      await infrastructure?.close();
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('serves the legacy SQLite app and the PostgreSQL app side by side', async () => {
      const apiPort = (api.app.getHttpServer().address() as AddressInfo).port;

      const [oldHealth, newHealth] = await Promise.all([
        request(legacyUrl).get('/health'),
        request(`http://127.0.0.1:${apiPort}`).get('/health'),
      ]);

      expect(oldHealth.status).toBe(200);
      expect(newHealth.status).toBe(200);
      expect(newHealth.body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
      expect(legacyUrl).not.toContain(String(apiPort));
      expect(dataSource.options.type).toBe('postgres');
      // The legacy app keeps answering its own routes while the new one runs.
      expect((await request(legacyUrl).get('/webhooks/tiktok/leads')).status).toBe(404);
      expect((await request(`http://127.0.0.1:${apiPort}`).get('/tasks')).status).toBe(404);
    });

    it('creates one remote lead from 20 parallel deliveries', async () => {
      const email = `parallel-${randomUUID()}@example.test`;
      const payload = leadEvent(`acceptance-${randomUUID()}`, email);
      const before = remoteLeadCreates().length;

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => signed(api.app, payload)),
      );

      expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
      expect(responses.filter((response) => response.body.duplicate === false)).toHaveLength(1);
      const lead = await syncedLead(email);
      expect(
        await dataSource
          .getRepository(WebhookEventEntity)
          .countBy({ eventKey: payload.event_id as string }),
      ).toBe(1);
      expect(await dataSource.getRepository(SubmissionEntity).countBy({ leadId: lead.id })).toBe(1);
      expect(remoteLeadCreates().length - before).toBe(1);
      expect(lead.bitrixLeadId).toMatch(/^\d+$/);
    }, 90_000);

    it('reconciles a create whose response was lost instead of creating the lead twice', async () => {
      const email = `lost-response-${randomUUID()}@example.test`;
      const before = remoteLeadCreates().length;
      // The mock stores the lead and then lets the request time out, as a dropped response would.
      crm.injectFault('crm.item.add', 'persist_then_timeout');

      await signed(api.app, leadEvent(`acceptance-${randomUUID()}`, email)).expect(200);
      const lead = await syncedLead(email);

      expect(remoteLeadCreates().length - before).toBe(1);
      expect(lead.bitrixLeadId).toMatch(/^\d+$/);
      // The lead is linked inside the sync operation; the operation itself settles a moment later.
      const settled = await waitFor('the sync operation to settle', async () => {
        const operations = await dataSource
          .getRepository(OperationEntity)
          .find({ where: { aggregateId: lead.id, kind: 'bitrix_lead_sync' } });
        return operations.every((operation) => operation.status !== 'processing')
          ? operations
          : undefined;
      });
      expect(settled.map((operation) => operation.status)).toEqual(['succeeded']);
      expect(crm.calls.some((call) => call.method === 'crm.item.list')).toBe(true);
    }, 120_000);
  });
});
