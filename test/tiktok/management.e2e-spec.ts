import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { TiktokAppModule } from '@/apps/tiktok/app.module.js';
import type { BitrixConfig } from '@config/bitrix.config.js';
import { OperationEntity } from '@core/queue/entities/operation.entity.js';
import { WebhookEventEntity } from '@core/queue/entities/webhook-event.entity.js';
import { BitrixAdapterModule } from '@modules/crm-integration/bitrix-adapter.module.js';
import { CrmIntegrationModule } from '@modules/crm-integration/crm-integration.module.js';
import { CRM_GATEWAY } from '@modules/crm-integration/ports/crm-gateway.port.js';
import type { CrmGateway } from '@modules/crm-integration/ports/crm-gateway.port.js';
import { DealEntity } from '@modules/crm-integration/entities/deal.entity.js';
import { ConfigurationEntity } from '@modules/crm-integration/entities/configuration.entity.js';
import { ConfigurationHeadEntity } from '@modules/crm-integration/entities/configuration-head.entity.js';
import { LeadEntity } from '@modules/crm-integration/entities/lead.entity.js';
import { LeadIdentityEntity } from '@modules/crm-integration/entities/lead-identity.entity.js';
import { AuditEventEntity } from '@modules/crm-integration/entities/audit-event.entity.js';
import { IntegrationUserEntity } from '@modules/integration-auth/entities/integration-user.entity.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';
import { createTestApp } from './utils/create-test-app.js';
import type { TestApp } from './utils/create-test-app.js';
import { createTestInfrastructure } from './utils/test-infrastructure.js';
import type { TestInfrastructure } from './utils/test-infrastructure.js';

const PASSWORD = 'safe-test-password-123';

@Module({})
class ManagementTestModule {}

function buildRootModule(endpoint: string): Type<unknown> {
  const bitrixConfig: BitrixConfig = {
    clientId: '',
    clientSecret: '',
    portalDomain: '',
    requisitePresetId: 1,
    webhookUrl: endpoint,
    timeoutMs: 200,
    stateTtlSeconds: 600,
    refreshSkewSeconds: 60,
  };
  Module({
    imports: [
      TiktokAppModule,
      CrmIntegrationModule.register({
        imports: [
          BitrixAdapterModule.register({
            portalKey: 'management-e2e-portal',
            namespace: `management-e2e-${randomUUID()}`,
            bitrix: bitrixConfig,
            limiter: { intervalMs: 1, maxWaitMs: 1000, cooldownMs: 1 },
          }),
        ],
      }),
    ],
  })(ManagementTestModule);
  return ManagementTestModule;
}

describe('CRM management API', () => {
  let infrastructure: TestInfrastructure;
  let testApp: TestApp;
  let dataSource: DataSource;
  let server: ProviderServer;
  let tokens: Record<string, string>;

  beforeAll(async () => {
    infrastructure = await createTestInfrastructure();
    server = new ProviderServer({ bitrix: new BitrixStore(), tiktok: new TiktokStore() });
    await server.listen();
    testApp = await createTestApp(
      {
        TIKTOK_DATABASE_URL: process.env.TIKTOK_TEST_DATABASE_URL ?? '',
        TIKTOK_DATABASE_SCHEMA: infrastructure.database.schema,
        TIKTOK_REDIS_URL: process.env.TIKTOK_TEST_REDIS_URL ?? '',
        INTEGRATION_QUEUE_PREFIX: infrastructure.redisPrefix,
      },
      buildRootModule(server.bitrixEndpoint),
    );
    dataSource = testApp.app.get<DataSource>(getDataSourceToken('tiktok'));
  });

  beforeEach(async () => {
    const bcrypt = await import('bcrypt');
    const users = [
      [`management-operator-${randomUUID()}`, ['integration_operator']],
      [`management-analyst-${randomUUID()}`, ['integration_analyst']],
      [`management-admin-${randomUUID()}`, ['integration_admin']],
    ] as const;
    await dataSource.getRepository(IntegrationUserEntity).save(
      await Promise.all(
        users.map(async ([username, roles]) => ({
          id: randomUUID(),
          username,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          roles: [...roles],
          active: true,
          authVersion: 1,
        })),
      ),
    );
    tokens = {};
    for (const [username, roles] of users) {
      const response = await request(testApp.app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: PASSWORD })
        .expect(200);
      tokens[
        roles[0] === 'integration_operator'
          ? 'management-operator'
          : roles[0] === 'integration_analyst'
            ? 'management-analyst'
            : 'management-admin'
      ] = response.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await testApp.close();
    await server.close();
    await infrastructure.close();
  });

  it('lists paginated TikTok leads with opaque external IDs and redacted fields', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => saveLead(index)));
    const now = Date.now();
    const response = await request(testApp.app.getHttpServer())
      .get(
        '/api/v1/leads?page=1&limit=10&source=tiktok&campaign_id=campaign-1&sync_status=pending&business_status=new&timeBasis=createdAt',
      )
      .query({
        from: new Date(now - 10 * 60_000).toISOString(),
        to: new Date(now + 10 * 60_000).toISOString(),
      })
      .set('Authorization', `Bearer ${tokens['management-analyst']}`)
      .expect(200);

    expect(response.body).toMatchObject({ total: 12, page: 1, limit: 10, timeBasis: 'createdAt' });
    expect(response.body.items).toHaveLength(10);
    expect(response.body.items[0]).toMatchObject({ source: 'tiktok' });
    expect(response.body.items[0].externalId).toMatch(/^tiktok:/);
    expect(JSON.stringify(response.body)).not.toContain('rawBody');
    expect(JSON.stringify(response.body)).not.toContain('accessToken');
  });

  it('rejects limits above 100 and denies read access to roles without lead permission', async () => {
    await request(testApp.app.getHttpServer())
      .get('/api/v1/leads?limit=101')
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .expect(400);
    await request(testApp.app.getHttpServer())
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${tokens['management-analyst']}`)
      .expect(200);
  });

  it('filters deals by status and external Bitrix assignee ID', async () => {
    const leadId = await saveLead(1);
    await dataSource.getRepository(DealEntity).save({
      id: uuidv7(),
      leadId,
      portalKey: 'management-e2e-portal',
      bitrixDealId: 'opaque-deal:42',
      title: 'Managed deal',
      amount: '1250.5000',
      currency: 'VND',
      pipelineId: '1',
      stageId: 'C1:NEW',
      stageSemantics: 'open',
      stageDeletedAt: null,
      probability: 30,
      assignedTo: 'sales:001',
      ruleRevision: 1,
      conversionStatus: 'completed',
      remoteModifiedAt: new Date(),
      everWonAt: null,
      currentSnapshotHash: null,
      version: 1,
    });
    const response = await request(testApp.app.getHttpServer())
      .get('/api/v1/deals?status=open&assigned_to=sales%3A001&limit=10')
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .expect(200);

    expect(response.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(response.body.items[0]).toMatchObject({
      bitrixDealId: 'opaque-deal:42',
      assignedTo: 'sales:001',
      stageId: 'C1:NEW',
      amount: '1250.5000',
      currency: 'VND',
      probability: 30,
      conversionStatus: 'completed',
    });
  });

  it('returns redacted operation details and rejects malformed local operation IDs', async () => {
    const operation = await saveOperation({ status: 'dead_letter', attempt: 4 });
    const response = await request(testApp.app.getHttpServer())
      .get(`/api/v1/operations/${operation.id}`)
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .expect(200);
    expect(response.body).toMatchObject({
      id: operation.id,
      status: 'dead_letter',
      attempt: 4,
      errorCode: 'REMOTE_TIMEOUT',
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive remote response');
    expect(JSON.stringify(response.body)).not.toContain('access_token');
    await request(testApp.app.getHttpServer())
      .get('/api/v1/operations/not-a-uuid')
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .expect(400);
    await request(testApp.app.getHttpServer())
      .get(`/api/v1/operations/${operation.id}`)
      .set('Authorization', `Bearer ${tokens['management-analyst']}`)
      .expect(403);
  });

  it('rejects retry while active and keeps attempt/config history when retrying a dead letter', async () => {
    const active = await saveOperation({ status: 'processing', attempt: 2 });
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${active.id}/retry`)
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .send({ reason: 'temporary outage resolved' })
      .expect(409);

    const dead = await saveOperation({ status: 'dead_letter', attempt: 5 });
    const reason = 'retry for mary@example.test +84901234567 token=abc123';
    const response = await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${dead.id}/retry`)
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .send({ reason })
      .expect(202);
    expect(response.body).toMatchObject({
      status: 'pending',
      attempt: 5,
      configRevisions: { mapping: 7, rules: 3 },
    });
    const stored = await dataSource.getRepository(OperationEntity).findOneByOrFail({ id: dead.id });
    expect(stored.configRevisions).toEqual({ mapping: 7, rules: 3 });
    expect(stored.attempt).toBe(5);
    const audit = await dataSource
      .getRepository(AuditEventEntity)
      .findOneByOrFail({ aggregateId: dead.id, eventType: 'operation.retry_requested' });
    const auditMetadata = JSON.stringify(audit.metadata);
    expect(auditMetadata).not.toContain('mary@example.test');
    expect(auditMetadata).not.toContain('+84901234567');
    expect(auditMetadata).not.toContain('abc123');
  });

  it('requires an administrator to resolve operations and starts a new version after absence confirmation', async () => {
    const leadId = await saveLead(30);
    const operation = await saveOperation({
      status: 'reconcile_required',
      aggregateId: leadId,
      payload: { leadId },
      kind: 'bitrix_lead_sync',
    });
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${operation.id}/resolve`)
      .set('Authorization', `Bearer ${tokens['management-operator']}`)
      .send({ action: 'confirm_remote_absent', reason: 'checked mock CRM' })
      .expect(403);
    const response = await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${operation.id}/resolve`)
      .set('Authorization', `Bearer ${tokens['management-admin']}`)
      .send({ action: 'confirm_remote_absent', reason: 'checked mock CRM' })
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'pending',
      attempt: 0,
      configRevisions: { mapping: 7, rules: 3 },
    });
    expect(response.body.id).not.toBe(operation.id);
    const next = await dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: response.body.id });
    expect(next.operationKey).toContain(`${operation.operationKey}/resolution/`);
    expect(next.payload).toMatchObject({
      sourceOperationId: operation.id,
      remoteAbsenceConfirmed: true,
    });
    const original = await dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: operation.id });
    expect(original.status).toBe('reconcile_required');
  });

  it('reprocesses under current config in a new operation version', async () => {
    const leadId = await saveLead(31);
    await dataSource.getRepository(ConfigurationEntity).save([
      { id: uuidv7(), key: 'mapping', revision: 12, value: {}, createdBy: null },
      { id: uuidv7(), key: 'rules', revision: 8, value: {}, createdBy: null },
    ]);
    await dataSource.getRepository(ConfigurationHeadEntity).save([
      { key: 'mapping', revision: 12 },
      { key: 'rules', revision: 8 },
    ]);
    const operation = await saveOperation({
      status: 'dead_letter',
      aggregateId: leadId,
      payload: { leadId },
      kind: 'bitrix_lead_sync',
    });
    const response = await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${operation.id}/resolve`)
      .set('Authorization', `Bearer ${tokens['management-admin']}`)
      .send({ action: 'reprocess_with_current_config', reason: 'mapping fixed' })
      .expect(200);
    expect(response.body.id).not.toBe(operation.id);
    expect(response.body).toMatchObject({
      status: 'pending',
      configRevisions: { mapping: 12, rules: 8 },
    });
    const original = await dataSource
      .getRepository(OperationEntity)
      .findOneByOrFail({ id: operation.id });
    expect(original.status).toBe('dead_letter');
  });

  it('does not move an identity owned by another lead during identity resolution', async () => {
    const ownerId = await saveLead(41);
    const selectedId = await saveLead(42);
    const email = 'owned@example.test';
    await dataSource.getRepository(LeadIdentityEntity).save({
      id: uuidv7(),
      advertiserId: 'management-e2e',
      identityType: 'email',
      normalizedValue: email,
      leadId: ownerId,
    });
    const eventId = uuidv7();
    await dataSource.getRepository(WebhookEventEntity).save({
      id: eventId,
      provider: 'tiktok',
      providerMode: 'mock',
      scopeKey: 'management-e2e',
      advertiserId: 'management-e2e',
      portalKey: 'management-e2e-portal',
      eventKey: `event-${randomUUID()}`,
      eventType: 'lead.generate',
      occurredAt: new Date(),
      receivedAt: new Date(),
      rawBody: Buffer.from('{}'),
      payload: {},
      payloadHash: randomUUID().replaceAll('-', '').slice(0, 64),
      status: 'quarantined',
      errorCode: 'IDENTITY_CONFLICT',
    });
    const operation = await saveOperation({
      status: 'quarantined',
      payload: { eventId },
      kind: 'tiktok_ingest',
    });
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${operation.id}/resolve`)
      .set('Authorization', `Bearer ${tokens['management-admin']}`)
      .send({
        action: 'select_identity_target',
        targetLeadId: selectedId,
        identityTargets: { email },
        reason: 'selected matching customer record',
      })
      .expect(409);
    const stored = await dataSource.getRepository(LeadIdentityEntity).findOneByOrFail({
      advertiserId: 'management-e2e',
      identityType: 'email',
      normalizedValue: email,
    });
    expect(stored.leadId).toBe(ownerId);
  });

  it('does not link a remote lead whose marker does not match the local aggregate', async () => {
    const leadId = await saveLead(51);
    const gateway = testApp.app.get<CrmGateway>(CRM_GATEWAY);
    const remote = await gateway.createLead(
      { title: 'Unrelated remote lead', name: 'Unrelated remote lead' },
      `aasc-tiktok/${uuidv7()}`,
    );
    const operation = await saveOperation({
      status: 'reconcile_required',
      aggregateId: leadId,
      payload: { leadId },
      kind: 'bitrix_lead_sync',
    });
    await request(testApp.app.getHttpServer())
      .post(`/api/v1/operations/${operation.id}/resolve`)
      .set('Authorization', `Bearer ${tokens['management-admin']}`)
      .send({ action: 'link_remote', remoteId: remote.id, reason: 'checked mock CRM' })
      .expect(409);
    const lead = await dataSource.getRepository(LeadEntity).findOneByOrFail({ id: leadId });
    expect(lead.bitrixLeadId).toBeNull();
  });

  async function saveLead(index: number): Promise<string> {
    const id = uuidv7();
    const date = new Date(Date.now() - index * 1000);
    await dataSource.getRepository(LeadEntity).save({
      id,
      externalId: `tiktok:${randomUUID()}`,
      advertiserId: 'management-e2e',
      scopeKey: 'management-e2e',
      portalKey: 'management-e2e-portal',
      providerMode: 'mock',
      name: `Lead ${index}`,
      email: `private-${index}@example.test`,
      phone: null,
      city: 'Hanoi',
      interests: [],
      score: 50,
      scoreVersion: 1,
      scoreBreakdown: { email: 15 },
      businessStatus: 'new',
      syncStatus: 'pending',
      bitrixLeadId: null,
      firstSubmissionId: null,
      lastSubmissionId: null,
      firstTouchAt: date,
      firstTouchCampaignId: 'campaign-1',
      lastTouchAt: null,
      convertedAt: null,
      dealCreatedAt: null,
      fieldProvenance: {},
      lastWrittenFields: {},
      version: 1,
      lastErrorCode: null,
      createdAt: date,
      updatedAt: date,
    });
    return id;
  }

  async function saveOperation(
    overrides: Partial<OperationEntity> & { status: OperationEntity['status']; attempt?: number },
  ): Promise<OperationEntity> {
    const { status, attempt, ...rest } = overrides;
    return dataSource.getRepository(OperationEntity).save({
      id: uuidv7(),
      operationKey: `management/${randomUUID()}`,
      kind: 'bitrix_lead_sync',
      aggregateId: null,
      targetVersion: 1,
      status,
      attempt: attempt ?? 0,
      leaseUntil: null,
      leaseToken: null,
      remoteId: null,
      lastErrorCode: 'REMOTE_TIMEOUT',
      lastErrorDetail: 'sensitive remote response access_token=secret-value',
      nextAttemptAt: null,
      payload: {},
      configRevisions: { mapping: 7, rules: 3 },
      actorId: null,
      completedAt: null,
      ...rest,
    });
  }
});
