import { Test } from '@nestjs/testing';

import { BitrixCoreModule, BITRIX_CONFIG } from '@modules/bitrix/bitrix-core.module.js';
import { BITRIX_INSTALLATION_STORE } from '@modules/bitrix/ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '@modules/bitrix/ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '@modules/bitrix/ports/bitrix-request-limiter.port.js';
import { BitrixCrmGateway } from '@modules/crm-integration/gateways/bitrix-crm.gateway.js';
import {
  createMockWebhookSignature,
  MockTiktokAdapter,
} from '@modules/tiktok/adapters/mock-tiktok.adapter.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';

let server: ProviderServer;
let crmStore: BitrixStore;
let tiktokStore: TiktokStore;

function controlUrl(path: string): string {
  return new URL(`/__control/${path}`, new URL(server.bitrixEndpoint).origin).toString();
}

async function createGateway(): Promise<{
  gateway: BitrixCrmGateway;
  close(): Promise<void>;
}> {
  const core = BitrixCoreModule.register({
    providers: [
      {
        provide: BITRIX_CONFIG,
        useValue: {
          clientId: '',
          clientSecret: '',
          portalDomain: '',
          requisitePresetId: 0,
          webhookUrl: server.bitrixEndpoint,
          timeoutMs: 100,
          stateTtlSeconds: 60,
          refreshSkewSeconds: 60,
        },
      },
      { provide: BITRIX_INSTALLATION_STORE, useValue: {} },
      {
        provide: BITRIX_REQUEST_LIMITER,
        useValue: { acquire: async () => {}, saturate: async () => {} },
      },
      {
        provide: BITRIX_OAUTH_STATE_STORE,
        useValue: {
          issue: () => Promise.resolve('state'),
          consume: () => Promise.resolve(true),
        },
      },
    ],
  });
  const moduleRef = await Test.createTestingModule({
    imports: [core],
    providers: [BitrixCrmGateway],
  }).compile();
  return {
    gateway: moduleRef.get(BitrixCrmGateway),
    close: () => moduleRef.close(),
  };
}

async function firstCandidate(gateway: BitrixCrmGateway, marker: string) {
  const candidates = await gateway.findLeadCandidates({ marker, limit: 1 });
  const candidate = candidates[0];
  if (!candidate) throw new Error(`Missing mock lead ${marker}`);
  return candidate;
}

describe('provider contracts', () => {
  beforeAll(async () => {
    crmStore = new BitrixStore();
    tiktokStore = new TiktokStore();
    server = new ProviderServer({ bitrix: crmStore, tiktok: tiktokStore, exposeControl: true });
    await server.listen();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  it('uses the HTTP Bitrix gateway for metadata, paginated candidate lookup, canonical fm and create IDs', async () => {
    const { gateway, close } = await createGateway();
    try {
      const metadata = await gateway.metadata();
      expect(metadata.lead.fields).toHaveProperty('fm');
      expect(metadata.stages).toContainEqual({
        id: 'C1:NEW',
        name: 'Pipeline new',
        categoryId: 1,
        semantic: null,
      });
      const first = await gateway.createLead(
        {
          title: 'TikTok lead',
          fm: [{ typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' }],
        },
        'tiktok-submission-1',
      );
      expect(first.id).toBeTruthy();
      const candidates = await gateway.findLeadCandidates({
        marker: 'tiktok-submission-1',
        limit: 1,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({ id: first.id, marker: 'tiktok-submission-1' });
      expect(candidates[0]?.fields.fm).toEqual([
        { typeId: 'PHONE', valueType: 'WORK', value: '+84901234567' },
      ]);
      await expect(gateway.getLead(first.id)).resolves.toMatchObject({ id: first.id });
      await expect(gateway.completeLead(first.id, 'IN_PROGRESS')).resolves.toMatchObject({
        fields: { statusId: 'IN_PROGRESS' },
      });
      expect(await gateway.findLeadCandidates({ marker: 'missing', limit: 1, offset: 1 })).toEqual(
        [],
      );
      const deal = await gateway.createDeal(
        { title: 'TikTok conversion', categoryId: 0 },
        'deal-marker-1',
      );
      expect(deal.id).toBeTruthy();
      expect(await gateway.findDeals({ marker: 'deal-marker-1', limit: 1 })).toMatchObject([
        { id: deal.id, marker: 'deal-marker-1' },
      ]);
      await expect(gateway.getDeal(deal.id)).resolves.toMatchObject({ id: deal.id });
      const timeline = await gateway.addTimeline({
        entityType: 'lead',
        entityId: first.id,
        marker: 'timeline-marker-1',
        comment: 'Synced from TikTok',
      });
      await expect(gateway.findTimeline(timeline.marker)).resolves.toEqual([timeline]);
      await gateway.createLead({ title: 'Page one' }, 'page-one');
      await gateway.createLead({ title: 'Page two' }, 'page-two');
      await gateway.createLead({ title: 'Page three' }, 'page-three');
      expect(await gateway.findLeadCandidates({ limit: 2, offset: 0 })).toHaveLength(2);
      expect(await gateway.findLeadCandidates({ limit: 2, offset: 2 })).toHaveLength(2);
    } finally {
      await close();
    }
  });

  it('recovers an ambiguous create by marker and surfaces auth, rate-limit and stale-snapshot behavior', async () => {
    const { gateway, close } = await createGateway();
    try {
      const faultResponse = await fetch(controlUrl('bitrix/fault'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'crm.item.add', fault: 'persist_then_timeout' }),
      });
      expect(faultResponse.status).toBe(200);
      await expect(
        gateway.createLead({ title: 'Ambiguous' }, 'ambiguous-marker'),
      ).rejects.toBeDefined();
      await expect(
        gateway.findLeadCandidates({ marker: 'ambiguous-marker', limit: 10 }),
      ).resolves.toHaveLength(1);

      crmStore.injectFault('crm.item.get', 'auth_invalid');
      await expect(
        gateway.getLead((await firstCandidate(gateway, 'ambiguous-marker')).id),
      ).rejects.toBeDefined();
      crmStore.injectFault('crm.item.get', 'rate_limit');
      await expect(
        gateway.getLead((await firstCandidate(gateway, 'ambiguous-marker')).id),
      ).rejects.toBeDefined();
      crmStore.injectFault('crm.item.get', 'stale_snapshot');
      await expect(
        gateway.getLead((await firstCandidate(gateway, 'ambiguous-marker')).id),
      ).resolves.toMatchObject({ stale: true });
    } finally {
      await close();
    }
  });

  it('supports mock TikTok detail, pagination, partial feedback, 429 and invalid authentication', async () => {
    const adapter = new MockTiktokAdapter(server.tiktokBaseUrl, 'mock-api-key');
    const raw = Buffer.from(
      JSON.stringify({
        eventKey: 'evt-1',
        eventType: 'lead.generate',
        advertiserId: 'advertiser-1',
        payload: { leadId: 'lead-1' },
      }),
    );
    expect(
      adapter.parseWebhook(raw, {
        'x-mock-signature': createMockWebhookSignature(raw, 'mock-webhook-secret'),
      }),
    ).toMatchObject({ eventKey: 'evt-1', advertiserId: 'advertiser-1' });
    expect(() => adapter.parseWebhook(raw, { 'x-mock-signature': 'wrong' })).toThrow(
      'MOCK_SIGNATURE_INVALID',
    );
    tiktokStore.setLead({
      id: 'lead-1',
      advertiserId: 'advertiser-1',
      fields: { email: 'person@example.com' },
    });
    await expect(adapter.getLeadDetail('lead-1')).resolves.toMatchObject({ id: 'lead-1' });
    tiktokStore.setSpendPages([
      {
        items: [{ campaignId: 'c1', date: '2026-10-01', amount: '12.30', currency: 'USD' }],
        nextCursor: 'page-2',
      },
      { items: [{ campaignId: 'c2', date: '2026-10-01', amount: '0', currency: 'USD' }] },
    ]);
    const firstPage = await adapter.fetchSpend({ from: '2026-10-01', to: '2026-10-02' });
    await expect(
      adapter.fetchSpend({ from: '2026-10-01', to: '2026-10-02' }, firstPage.nextCursor),
    ).resolves.toMatchObject({ items: [{ campaignId: 'c2' }] });
    tiktokStore.setNextFeedbackResult([
      { eventId: 'event-1', status: 'accepted' },
      { eventId: 'event-2', status: 'rejected', errorCode: 'INVALID' },
    ]);
    tiktokStore.injectFault('feedback', 'partial_feedback');
    await expect(
      adapter.sendEvents([{ eventId: 'event-1' }, { eventId: 'event-2' }]),
    ).resolves.toEqual([
      { eventId: 'event-1', status: 'accepted' },
      { eventId: 'event-2', status: 'rejected', errorCode: 'INVALID' },
    ]);
    const faultResponse = await fetch(controlUrl('tiktok/fault'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'feedback', fault: 'rate_limit' }),
    });
    expect(faultResponse.status).toBe(200);
    await expect(adapter.sendEvents([{ eventId: 'event-3' }])).rejects.toMatchObject({
      status: 429,
    });
    tiktokStore.injectFault('lead', 'auth_invalid');
    await expect(adapter.getLeadDetail('lead-1')).rejects.toMatchObject({ status: 401 });
  });
});
