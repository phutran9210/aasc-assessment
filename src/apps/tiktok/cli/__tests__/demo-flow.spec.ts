import { runDemo } from '../demo-flow.js';

const options = {
  apiBaseUrl: 'http://api.test',
  bitrixRestUrl: 'http://bitrix.test/rest/',
  advertiserId: 'adv',
  portalKey: 'portal',
  webhookSecret: 'webhook-secret',
  bitrixEventSecret: 'bitrix-secret',
  username: 'operator',
  password: 'password',
  timeoutMs: 50,
};

describe('runDemo', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('completes the public API workflow and downloads each export format', async () => {
    let lead = { id: 'lead-1', email: '', syncStatus: 'synced', bitrixLeadId: 'remote-lead' };
    const createdDeal = {
      id: 'deal-1',
      leadId: 'lead-1',
      bitrixDealId: 'remote-deal',
      stageSemantics: 'open',
      conversionStatus: 'completed',
      amount: null,
    };
    const wonDeal = { ...createdDeal, stageSemantics: 'won' };
    let dealReads = 0;
    let mappingReads = 0;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const rawUrl = input instanceof Request ? input.url : input;
      const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
      if (url.pathname === '/health') return Response.json({ status: 'ok' });
      if (url.pathname.endsWith('/auth/login')) return Response.json({ accessToken: 'token' });
      if (url.pathname.endsWith('/config/mappings'))
        return Response.json({ revision: mappingReads++ === 0 ? 0 : 1 });
      if (url.pathname === '/webhooks/tiktok/leads') {
        const payload = JSON.parse(init?.body as string) as { lead_data: { email: string } };
        lead = { ...lead, email: payload.lead_data.email };
        return Response.json({ accepted: true });
      }
      if (url.pathname === '/api/v1/leads') return Response.json({ items: [lead] });
      if (url.pathname === '/api/v1/deals')
        return Response.json({ items: [dealReads++ === 0 ? createdDeal : wonDeal] });
      if (url.pathname.endsWith('/crm.item.update')) return Response.json({ result: true });
      if (url.pathname === '/webhooks/bitrix24/deals') return Response.json({ accepted: true });
      if (url.pathname.endsWith('/analytics/conversion-rates'))
        return Response.json({ leads: 1, wonLeads: 1, leadToWonRate: 100 });
      if (url.pathname.endsWith('/analytics/campaign-performance'))
        return Response.json({ items: [] });
      if (url.pathname.endsWith('/reports/export'))
        return new Response(
          url.searchParams.get('format') === 'json' ? '[{"id":"lead-1"}]' : 'export-data',
        );
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const log = jest.fn();
    const result = await runDemo(options, log);
    expect(result).toMatchObject({
      health: 'ok',
      lead,
      deal: wonDeal,
      campaign: {},
      exports: { json: { rows: 1 } },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('mapping:'));
    expect((globalThis.fetch as jest.Mock).mock.calls).toHaveLength(15);
  });

  it('surfaces a failed API response with the step name and status', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    ) as typeof fetch;
    await expect(runDemo(options)).rejects.toThrow('health check failed with HTTP 503');
  });
});
