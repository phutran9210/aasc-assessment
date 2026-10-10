import {
  MockTiktokAdapter,
  ProviderHttpError,
  createMockWebhookSignature,
} from '../mock-tiktok.adapter.js';

describe('MockTiktokAdapter', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  const adapter = () => new MockTiktokAdapter('http://mock.test/', 'key', 'secret', 1000);

  it('verifies signed webhook envelopes and rejects bad signature, JSON, and fields', () => {
    const body = Buffer.from(
      JSON.stringify({
        eventKey: 'e1',
        eventType: 'lead',
        advertiserId: 'adv',
        payload: { id: 1 },
      }),
    );
    const signature = createMockWebhookSignature(body, 'secret');
    expect(adapter().parseWebhook(body, { 'x-mock-signature': signature })).toMatchObject({
      eventKey: 'e1',
      occurredAt: null,
      payload: { id: 1 },
    });
    expect(() => adapter().parseWebhook(body, {})).toThrow(ProviderHttpError);
    expect(() => adapter().parseWebhook(body, { 'x-mock-signature': '0'.repeat(64) })).toThrow(
      'MOCK_SIGNATURE_INVALID',
    );
    const sign = (value: Buffer) => createMockWebhookSignature(value, 'secret');
    expect(() =>
      adapter().parseWebhook(Buffer.from('{'), { 'x-mock-signature': sign(Buffer.from('{')) }),
    ).toThrow('WEBHOOK_JSON_INVALID');
    const incomplete = Buffer.from('{}');
    expect(() =>
      adapter().parseWebhook(incomplete, { 'x-mock-signature': sign(incomplete) }),
    ).toThrow('WEBHOOK_ENVELOPE_INVALID');
  });

  it('requests encoded lead IDs, feedback results and validated spend pages', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'lead/1' }))
      .mockResolvedValueOnce(
        Response.json({ results: [{ eventId: 'e', status: 'accepted' }] }, { status: 207 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ campaignId: 'c', date: '2026-01-01', amount: '1.00', currency: 'USD' }],
        }),
      );
    await expect(adapter().getLeadDetail('lead/1')).resolves.toEqual({ id: 'lead/1' });
    await expect(adapter().sendEvents([{ eventId: 'e' }])).resolves.toEqual([
      { eventId: 'e', status: 'accepted' },
    ]);
    await expect(
      adapter().fetchSpend({ from: '2026-01-01', to: '2026-02-01', campaignId: 'c' }, 'next'),
    ).resolves.toMatchObject({ items: [{ amount: '1.00' }] });
    expect(new URL(fetchSpy.mock.calls[0][0] as string).href).toBe(
      'http://mock.test/leads/lead%2F1',
    );
    expect(new URL(fetchSpy.mock.calls[2][0] as string).search).toContain(
      'campaignId=c&cursor=next',
    );
  });

  it('maps transport, bad JSON, HTTP and malformed provider responses to stable errors', async () => {
    const api = adapter();
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    await expect(api.getLeadDetail('1')).rejects.toThrow('PROVIDER_UNAVAILABLE');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not-json'));
    await expect(api.getLeadDetail('1')).rejects.toThrow('PROVIDER_RESPONSE_INVALID');
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 'NO_ACCESS' }, { status: 403 }));
    await expect(api.getLeadDetail('1')).rejects.toThrow('NO_ACCESS');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({}));
    await expect(api.sendEvents([])).rejects.toThrow('FEEDBACK_RESPONSE_INVALID');
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ results: [{ eventId: 'x', status: 'unknown' }] }));
    await expect(api.sendEvents([])).rejects.toThrow('FEEDBACK_RESULT_INVALID');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ items: [{}] }));
    await expect(api.fetchSpend({ from: 'a', to: 'b' })).rejects.toThrow('SPEND_ROW_INVALID');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({}));
    await expect(api.fetchSpend({ from: 'a', to: 'b' })).rejects.toThrow('SPEND_RESPONSE_INVALID');
  });
});
