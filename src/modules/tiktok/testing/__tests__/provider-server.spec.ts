import { ProviderServer } from '../provider-server.js';
import { BitrixStore } from '../bitrix-store.js';
import { TiktokStore } from '../tiktok-store.js';

describe('mock provider stores and HTTP server', () => {
  const bitrix = new BitrixStore();
  const tiktok = new TiktokStore();
  const server = new ProviderServer({ bitrix, tiktok, exposeControl: true, tiktokApiKey: 'key' });
  let base: string;

  beforeAll(async () => {
    await server.listen();
    base = server.bitrixEndpoint.replace('/rest/1/mock/', '');
  });
  afterAll(async () => {
    await server.close();
  });

  const request = async (path: string, method = 'GET', body?: unknown, token?: string) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };

  it('serves health, validates control requests, and handles unknown routes', async () => {
    expect((await request('/__control/health')).body).toEqual({ status: 'ok' });
    expect((await request('/missing')).status).toBe(404);
    expect((await request('/__control/tiktok/leads', 'POST', {})).body.code).toBe('LEAD_INVALID');
    expect((await request('/__control/tiktok/spend', 'POST', {})).body.code).toBe('SPEND_INVALID');
    expect((await request('/__control/tiktok/feedback-result', 'POST', {})).body.code).toBe(
      'FEEDBACK_INVALID',
    );
    expect(
      (await request('/__control/bitrix/fault', 'POST', { method: 'x', fault: 'x' })).body.code,
    ).toBe('FAULT_INVALID');
    expect(
      (await request('/__control/tiktok/fault', 'POST', { method: 'lead', fault: 'x' })).body.code,
    ).toBe('FAULT_INVALID');
    expect((await request('/rest/1/mock/crm.item.get')).status).toBe(405);
  });

  it('covers disabled routes, malformed JSON, non-object bodies, and idempotent shutdown', async () => {
    expect((await request('/__control/unknown')).status).toBe(404);
    expect((await request('/tiktok/leads/lead-1', 'POST', {}, 'key')).status).toBe(404);
    expect((await request('/tiktok/events', 'GET', undefined, 'key')).status).toBe(404);
    expect((await request('/tiktok/events', 'POST', { events: 'invalid' }, 'key')).status).toBe(
      200,
    );

    const malformed = await fetch(`${base}/__control/tiktok/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    });
    expect(malformed.status).toBe(400);
    const arrayBody = await fetch(`${base}/__control/tiktok/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    expect(arrayBody.status).toBe(400);

    const isolated = new ProviderServer({
      bitrix: new BitrixStore(),
      tiktok: new TiktokStore(),
      exposeControl: false,
    });
    expect(() => isolated.bitrixEndpoint).toThrow('not listening');
    expect(() => isolated.tiktokBaseUrl).toThrow('not listening');
    await isolated.listen();
    const hiddenControl = await fetch(
      `${isolated.bitrixEndpoint.replace('/rest/1/mock/', '')}/__control/health`,
    );
    expect(hiddenControl.status).toBe(404);
    await isolated.close();
    await isolated.close();
  });

  it('exercises the TikTok control plane, authentication and provider results', async () => {
    await request('/__control/tiktok/leads', 'POST', {
      id: 'lead-1',
      advertiserId: 'adv',
      fields: { email: 'a@test' },
    });
    expect((await request('/tiktok/leads/lead-1', 'GET', undefined, 'bad')).status).toBe(401);
    expect((await request('/tiktok/leads/lead-1', 'GET', undefined, 'key')).body.id).toBe('lead-1');
    expect((await request('/tiktok/leads/missing', 'GET', undefined, 'key')).status).toBe(404);
    await request('/__control/tiktok/spend', 'POST', {
      pages: [{ items: [{ spend: '2' }], nextCursor: null }],
    });
    expect((await request('/tiktok/spend', 'GET', undefined, 'key')).body.items).toHaveLength(1);
    expect(
      (await request('/tiktok/spend?cursor=page-9', 'GET', undefined, 'key')).body.items,
    ).toEqual([]);
    await request('/__control/tiktok/feedback-result', 'POST', {
      results: [{ eventId: 'e', status: 'accepted' }],
    });
    expect(
      (await request('/tiktok/events', 'POST', { events: [] }, 'key')).body.results,
    ).toHaveLength(1);
    await request('/__control/tiktok/fault', 'POST', { method: 'lead', fault: 'rate_limit' });
    expect((await request('/tiktok/leads/lead-1', 'GET', undefined, 'key')).status).toBe(429);
    await request('/__control/tiktok/fault', 'POST', {
      method: 'feedback',
      fault: 'partial_feedback',
    });
    expect((await request('/tiktok/events', 'POST', { events: [] }, 'key')).status).toBe(200);
    expect((await request('/__control/calls?provider=tiktok')).body.calls.length).toBeGreaterThan(
      0,
    );
    expect((await request('/__control/calls')).body.calls).toBeDefined();
  });

  it('accepts every supported provider fault and rejects malformed fault selectors', async () => {
    const isolated = new ProviderServer({
      bitrix: new BitrixStore(),
      tiktok: new TiktokStore(),
      exposeControl: true,
    });
    await isolated.listen();
    const isolatedBase = isolated.bitrixEndpoint.replace('/rest/1/mock/', '');
    const control = async (path: string, body: unknown) => {
      const response = await fetch(`${isolatedBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    try {
      for (const fault of [
        'persist_then_timeout',
        'timeout_without_persist',
        'rate_limit',
        'auth_invalid',
        'stale_snapshot',
      ]) {
        expect(
          (await control('/__control/bitrix/fault', { method: 'fault-probe', fault })).body,
        ).toEqual({ accepted: true });
      }
      for (const [method, fault] of [
        ['lead', 'rate_limit'],
        ['spend', 'auth_invalid'],
        ['feedback', 'partial_feedback'],
        ['lead', 'timeout_without_persist'],
      ]) {
        expect((await control('/__control/tiktok/fault', { method, fault })).body).toEqual({
          accepted: true,
        });
      }
      expect((await control('/__control/bitrix/fault', { fault: 'rate_limit' })).body.code).toBe(
        'FAULT_INVALID',
      );
      expect(
        (await control('/__control/tiktok/fault', { method: 'unknown', fault: 'rate_limit' })).body
          .code,
      ).toBe('FAULT_INVALID');
    } finally {
      await isolated.close();
    }
  });

  it('exercises Bitrix item, duplicate, paging, timeline, metadata and fault behavior', async () => {
    const rest = (method: string, payload: unknown = {}) =>
      request(`/rest/1/mock/${method}`, 'POST', payload);
    const fields = {
      title: 'Lead',
      originId: 'source-1',
      originatorId: 'aasc',
      email: 'a@test',
      phone: '+1',
      fm: [{ typeId: 'EMAIL', value: 'a@test' }],
    };
    const created = await rest('crm.item.add', { entityTypeId: 1, fields });
    expect(created.body.result.item.id).toBe('1');
    expect(
      (await rest('crm.item.fields', { entityTypeId: 1 })).body.result.fields.UF_CRM_CITY,
    ).toBeDefined();
    expect(
      (await rest('crm.duplicate.findbycomm', { type: 'EMAIL', values: ['a@test'] })).body.result
        .LEAD,
    ).toEqual(['1']);
    expect(
      (await rest('crm.duplicate.findbycomm', { type: 'PHONE', values: ['none'] })).body.result,
    ).toEqual({});
    await rest('crm.item.add', { entityTypeId: 2, fields: { title: 'Deal', leadId: '1' } });
    expect(
      (await rest('crm.item.list', { entityTypeId: 2, filter: { '=leadId': '1' }, start: 0 })).body
        .result.total,
    ).toBe(1);
    expect((await rest('crm.item.get', { entityTypeId: 2, id: '1' })).body.result.item.title).toBe(
      'Deal',
    );
    expect((await rest('crm.item.get', { entityTypeId: 2, id: 'missing' })).body.result).toBeNull();
    expect(
      (await rest('crm.item.update', { entityTypeId: 2, id: '1', fields: { title: 'Won' } })).body
        .result.item.title,
    ).toBe('Won');
    expect((await rest('crm.category.list')).body.result.categories).toHaveLength(2);
    expect(
      (await rest('crm.status.list', { filter: { ENTITY_ID: 'DEAL_STAGE_4' } })).body.result[0]
        .STATUS_ID,
    ).toBe('C4:NEW');
    expect((await rest('user.get')).body.result[0].ACTIVE).toBe(true);
    await rest('crm.timeline.comment.add', {
      fields: { ENTITY_ID: '1', ENTITY_TYPE: 'deal', COMMENT: 'note' },
    });
    expect(
      (await rest('crm.timeline.comment.list', { filter: { ENTITY_ID: '1', ENTITY_TYPE: 'deal' } }))
        .body.result,
    ).toHaveLength(1);
    await request('/__control/bitrix/fault', 'POST', {
      method: 'crm.item.get',
      fault: 'auth_invalid',
    });
    expect((await rest('crm.item.get', { entityTypeId: 1, id: '1' })).status).toBe(401);
    await request('/__control/bitrix/fault', 'POST', {
      method: 'crm.item.get',
      fault: 'stale_snapshot',
    });
    expect((await rest('crm.item.get', { entityTypeId: 1, id: '1' })).body.result.item.stale).toBe(
      true,
    );
    expect((await rest('unimplemented')).body.result).toBeNull();
  });
});
