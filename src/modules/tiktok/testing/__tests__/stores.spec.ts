import { BitrixStore } from '../bitrix-store.js';
import { TiktokStore } from '../tiktok-store.js';

describe('TiktokStore', () => {
  it('returns provider results and consumes one-shot faults and feedback overrides', () => {
    const store = new TiktokStore();
    store.setLead({ id: '1', advertiserId: 'adv', fields: { email: 'a@test' } });
    expect(store.execute('lead', { id: '1' }).status).toBe(200);
    expect(store.execute('lead', { id: 'missing' })).toMatchObject({ status: 404 });
    store.setSpendPages([
      { items: [], nextCursor: 'page-2' },
      { items: [{ spend: '9' }] } as never,
    ]);
    expect(store.execute('spend').body).toMatchObject({ nextCursor: 'page-2' });
    expect(store.execute('spend', { cursor: 'page-2' }).body).toMatchObject({
      items: [{ spend: '9' }],
    });
    store.setNextFeedbackResult([{ eventId: 'e', status: 'accepted' } as never]);
    expect(store.execute('feedback').body).toMatchObject({ results: [{ eventId: 'e' }] });
    expect(store.execute('feedback', { events: [{ eventId: 'next' }] }).body).toMatchObject({
      results: [{ eventId: 'next', status: 'accepted' }],
    });
    for (const fault of [
      'auth_invalid',
      'rate_limit',
      'partial_feedback',
      'timeout_without_persist',
    ] as const) {
      store.injectFault(
        fault === 'partial_feedback' || fault === 'timeout_without_persist' ? 'feedback' : 'lead',
        fault,
      );
      const result = store.execute(
        fault === 'partial_feedback' || fault === 'timeout_without_persist' ? 'feedback' : 'lead',
      );
      expect(result.status).toBe(
        fault === 'auth_invalid' ? 401 : fault === 'rate_limit' ? 429 : 200,
      );
      if (fault === 'timeout_without_persist') expect(result.hang).toBe(true);
    }
  });
});

describe('BitrixStore', () => {
  it('covers item filters, paging, duplicate communication fields and update misses', () => {
    const store = new BitrixStore();
    store.pageSize = 1;
    const add = (id: string, title: string, updatedTime: string) =>
      store.execute('crm.item.add', {
        entityTypeId: 1,
        fields: {
          title,
          originId: id,
          originatorId: 'aasc',
          email: 'e@test',
          phone: '+84',
          updatedTime,
          fm: [
            { TYPE_ID: 'EMAIL', VALUE: 'other@test' },
            { typeId: 'PHONE', value: '+85' },
          ],
        },
      });
    add('a', 'A', '2026-01-02T00:00:00.000Z');
    add('b', 'B', '2025-01-02T00:00:00.000Z');
    expect(
      store.execute('crm.item.list', { entityTypeId: 1, filter: { '=originId': 'b' } }).body.result,
    ).toMatchObject({ total: 1 });
    expect(
      store.execute('crm.item.list', {
        entityTypeId: 1,
        filter: {
          '=originatorId': 'aasc',
          '=EMAIL': 'e@test',
          '=PHONE': '+84',
          '>=updatedTime': '2100-01-01T00:00:00.000Z',
        },
        start: 0,
      }).body.result,
    ).toMatchObject({ total: 0 });
    expect(
      store.execute('crm.item.list', {
        entityTypeId: 1,
        filter: { '>=updatedTime': '2026-01-01T00:00:00.000Z' },
        start: 2,
      }).body.result,
    ).toMatchObject({ items: [] });
    expect(
      store.execute('crm.duplicate.findbycomm', { type: 'EMAIL', values: ['other@test', 4] }).body
        .result,
    ).toEqual({ LEAD: ['1', '2'] });
    expect(
      store.execute('crm.duplicate.findbycomm', { type: 'PHONE', values: ['+85'] }).body.result,
    ).toEqual({ LEAD: ['1', '2'] });
    expect(
      (
        store.execute('crm.item.update', { entityTypeId: 2, id: 'missing', fields: { title: 'x' } })
          .body.result as { item: unknown }
      ).item,
    ).toBeNull();
    expect(
      (
        store.execute('crm.status.list', { filter: { ENTITY_ID: 'DEAL_STAGE' } }).body
          .result as Array<{ STATUS_ID: string }>
      )[0].STATUS_ID,
    ).toBe('NEW');
  });

  it('supports fault responses and timeline defaults', () => {
    const store = new BitrixStore();
    for (const fault of [
      'rate_limit',
      'auth_invalid',
      'timeout_without_persist',
      'persist_then_timeout',
    ] as const) {
      store.injectFault('custom', fault);
      const result = store.execute('custom', {});
      expect(Boolean(result.hang)).toBe(
        fault === 'timeout_without_persist' || fault === 'persist_then_timeout',
      );
      expect(result.status).toBe(
        fault === 'rate_limit' ? 429 : fault === 'auth_invalid' ? 401 : 200,
      );
    }
    store.execute('crm.timeline.comment.add', {
      fields: { ENTITY_ID: '2', ENTITY_TYPE: 'unknown', COMMENT: 'note' },
    });
    expect(
      store.execute('crm.timeline.comment.list', {
        filter: { ENTITY_ID: '2', ENTITY_TYPE: 'lead' },
      }).body.result,
    ).toHaveLength(1);
    expect(
      (
        store.execute('crm.item.fields', { entityTypeId: 2 }).body.result as {
          fields: Record<string, unknown>;
        }
      ).fields.categoryId,
    ).toBeDefined();
  });
});
