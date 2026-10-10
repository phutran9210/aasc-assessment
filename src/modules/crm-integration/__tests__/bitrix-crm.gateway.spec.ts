import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { BitrixHttpError } from '@modules/bitrix/services/bitrix-http-transport.service.js';
import { BitrixCrmGateway } from '../gateways/bitrix-crm.gateway.js';

function setup(result: unknown = { items: [] }) {
  const callRaw = jest.fn().mockResolvedValue({ result });
  const gateway = new BitrixCrmGateway({ callRaw } as never);
  return { gateway, callRaw };
}

const ownLead = {
  id: 42,
  title: 'An',
  originatorId: 'aasc-tiktok',
  originId: 'aasc-tiktok/lead-1',
  fm: [{ typeId: 'EMAIL', value: 'an@example.test' }],
};

describe('BitrixCrmGateway', () => {
  it('builds exact candidate filters and returns only the requested page size', async () => {
    const { gateway, callRaw } = setup({ items: [ownLead, { id: 43, title: 'Other' }] });

    const candidates = await gateway.findLeadCandidates({
      marker: 'aasc-tiktok/lead-1',
      leadId: '42',
      email: 'an@example.test',
      phone: '+84901234567',
      offset: 4,
      limit: 1,
    });

    expect(candidates).toEqual([
      expect.objectContaining({ id: '42', title: 'An', marker: 'aasc-tiktok/lead-1' }),
    ]);
    expect(callRaw.mock.calls[0]?.[1]).toMatchObject({
      filter: {
        '=originatorId': 'aasc-tiktok',
        '=originId': 'aasc-tiktok/lead-1',
        '=leadId': '42',
        '=EMAIL': 'an@example.test',
        '=PHONE': '+84901234567',
      },
      start: 4,
    });
  });

  it.each([{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 1001 }])(
    'rejects invalid candidate pagination %#',
    async (query) => {
      const { gateway } = setup();
      await expect(gateway.findLeadCandidates(query)).rejects.toBeInstanceOf(RangeError);
    },
  );

  it('identifies foreign CRM origin and keeps a safe empty title fallback', async () => {
    const { gateway } = setup({
      items: [{ ID: '50', originatorId: 'another-app', originId: 'x' }],
    });

    await expect(gateway.findLeadCandidates({})).resolves.toEqual([
      expect.objectContaining({ id: '50', title: '', marker: null, foreignOrigin: true }),
    ]);
  });

  it('combines duplicate IDs from email and phone without fetching a lead twice', async () => {
    const { gateway, callRaw } = setup();
    callRaw.mockImplementation((method: string, payload: Record<string, unknown>) => {
      if (method === 'crm.duplicate.findbycomm') {
        return Promise.resolve({
          result: { LEAD: payload.type === 'EMAIL' ? [42, 43] : [43, 44] },
        });
      }
      return Promise.resolve({
        result: { item: { id: payload.id, title: `Lead ${String(payload.id)}` } },
      });
    });

    const leads = await gateway.findLeadDuplicates({
      email: 'an@example.test',
      phone: '+84901234567',
    });

    expect(leads.map((lead) => lead.id)).toEqual(['42', '43', '44']);
    expect(callRaw.mock.calls.filter(([method]) => method === 'crm.item.get')).toHaveLength(3);
  });

  it('treats a missing duplicate response list as no matches', async () => {
    const { gateway } = setup({ LEAD: null });
    await expect(gateway.findLeadDuplicates({ email: 'an@example.test' })).resolves.toEqual([]);
  });

  it('rejects missing records and refuses a create response without its marker', async () => {
    const { gateway, callRaw } = setup(null);
    await expect(gateway.getLead('42')).rejects.toBeInstanceOf(NotFoundException);
    await expect(gateway.getDeal('42')).rejects.toBeInstanceOf(NotFoundException);
    callRaw.mockResolvedValue({ result: { item: { id: 42, title: 'An' } } });
    await expect(gateway.createLead({ title: 'An' }, 'marker-1')).rejects.toThrow(
      'Bitrix lead response did not retain its external marker',
    );
    await expect(gateway.createDeal({ title: 'Deal' }, 'marker-1')).rejects.toThrow(
      'Bitrix deal response did not retain its external marker',
    );
  });

  it('sends the marker on create and returns the canonical CRM record', async () => {
    const { gateway, callRaw } = setup({ item: ownLead });

    await expect(gateway.createLead({ title: 'An' }, 'aasc-tiktok/lead-1')).resolves.toMatchObject({
      id: '42',
      marker: 'aasc-tiktok/lead-1',
    });
    expect(callRaw.mock.calls[0]?.[1]).toMatchObject({
      fields: { title: 'An', originatorId: 'aasc-tiktok', originId: 'aasc-tiktok/lead-1' },
    });
  });

  it('validates deal page bounds and sends a modified-since filter', async () => {
    const { gateway, callRaw } = setup({ items: [{ id: 7, fields: { title: 'Deal' } }] });
    for (const query of [
      { offset: -1, limit: 1 },
      { offset: 0, limit: 0 },
      { offset: 0, limit: 51 },
    ]) {
      await expect(gateway.listDealsPage(query)).rejects.toBeInstanceOf(RangeError);
    }
    await expect(
      gateway.listDealsPage({
        offset: 10,
        limit: 1,
        modifiedSince: new Date('2026-10-01T00:00:00Z'),
      }),
    ).resolves.toEqual([expect.objectContaining({ id: '7', title: 'Deal' })]);
    expect(callRaw.mock.calls[0]?.[1]).toMatchObject({
      filter: { '>=updatedTime': '2026-10-01T00:00:00.000Z' },
      start: 10,
    });
  });

  it('finds only timeline comments with the exact marker suffix', async () => {
    const { gateway } = setup([
      { ID: 1, COMMENT: 'Qualified\nref: marker-1' },
      { ID: 2, COMMENT: 'Another\nref: marker-2' },
      { ID: 3, COMMENT: null },
    ]);

    await expect(
      gateway.findTimeline({ entityType: 'lead', entityId: '42', marker: 'marker-1' }),
    ).resolves.toEqual([
      { id: '1', entityType: 'lead', entityId: '42', marker: 'marker-1', comment: 'Qualified' },
    ]);
  });

  it('translates provider failures according to whether the request may have run', async () => {
    const cases: Array<[Error, new (...args: never[]) => Error]> = [
      [new BitrixHttpError('timeout', undefined, undefined, true), GatewayTimeoutException],
      [new BitrixHttpError('rate', 'RATE_LIMIT', 429), HttpException],
      [new BitrixHttpError('missing', 'NOT_FOUND', 404), NotFoundException],
      [new BitrixHttpError('invalid', 'INVALID', 422), UnprocessableEntityException],
      [new BitrixHttpError('failed', 'FAILED', 503), BadGatewayException],
    ];
    for (const [error, expected] of cases) {
      const { gateway, callRaw } = setup();
      callRaw.mockRejectedValue(error);
      await expect(gateway.getLead('42')).rejects.toBeInstanceOf(expected);
    }
  });

  it('rejects malformed list and ID responses instead of silently accepting them', async () => {
    const { gateway, callRaw } = setup({ items: { id: 42 } });
    await expect(gateway.findDeals({})).rejects.toThrow('Bitrix list response was invalid');
    callRaw.mockResolvedValue({ result: { item: { id: -1 } } });
    await expect(gateway.getLead('42')).rejects.toThrow('Bitrix lead id was invalid');
  });

  it('parses CRM field metadata, stage semantics, and active users', async () => {
    const { gateway, callRaw } = setup();
    callRaw.mockImplementation((method: string, payload: Record<string, unknown>) => {
      if (method === 'crm.item.fields') {
        return Promise.resolve({
          result: {
            fields: {
              title: {
                type: 'string',
                title: 'Title',
                isRequired: true,
                isReadOnly: false,
                settings: { MAX_LENGTH: 180 },
              },
              UF_CRM_FLAG: { type: 'boolean', isMultiple: true },
            },
          },
        });
      }
      if (method === 'crm.category.list')
        return Promise.resolve({ result: { categories: [{ id: 0 }, { id: '1' }] } });
      if (method === 'user.get')
        return Promise.resolve({
          result: [{ ID: 7, NAME: 'An', LAST_NAME: 'Nguyen', ACTIVE: 'Y' }],
        });
      if (method === 'crm.status.list') {
        const category = (payload.filter as { ENTITY_ID: string }).ENTITY_ID;
        return Promise.resolve({
          result:
            category === 'DEAL_STAGE'
              ? [{ STATUS_ID: 'NEW', NAME: 'New', SEMANTICS: 'process' }]
              : [
                  { STATUS_ID: 'C1:WON', NAME: 'Won', EXTRA: { SEMANTICS: 'success' } },
                  { STATUS_ID: 'C1:LOST', NAME: 'Lost', SEMANTICS: 'failure' },
                ],
        });
      }
      throw new Error(`Unexpected method ${method}`);
    });

    const metadata = await gateway.metadata();

    expect(metadata.lead.fields).toMatchObject({
      title: { title: 'Title', type: 'string', required: true, readOnly: false, maxLength: 180 },
      UF_CRM_FLAG: { title: 'UF_CRM_FLAG', multiple: true },
    });
    expect(metadata.stages).toEqual([
      { id: 'NEW', name: 'New', categoryId: 0, semantic: null },
      { id: 'C1:WON', name: 'Won', categoryId: 1, semantic: 'won' },
      { id: 'C1:LOST', name: 'Lost', categoryId: 1, semantic: 'lost' },
    ]);
    expect(metadata.users).toEqual([{ id: '7', name: 'An Nguyen', active: true }]);
  });

  it('falls back to profile when the portal does not allow listing users', async () => {
    const { gateway, callRaw } = setup();
    callRaw.mockImplementation((method: string) => {
      if (method === 'user.get') return Promise.reject(new UnprocessableEntityException());
      if (method === 'profile') return Promise.resolve({ result: { ID: 9, NAME: 'Owner' } });
      if (method === 'crm.item.fields') return Promise.resolve({ result: { fields: {} } });
      if (method === 'crm.category.list') return Promise.resolve({ result: { categories: [] } });
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(gateway.metadata()).resolves.toMatchObject({
      users: [{ id: '9', name: 'Owner', active: true }],
    });
  });

  it('rejects malformed category and field metadata rather than accepting it silently', async () => {
    const { gateway, callRaw } = setup();
    callRaw.mockImplementation((method: string) => {
      if (method === 'crm.item.fields')
        return Promise.resolve({
          result: { fields: { title: { type: 'string', isRequired: 'Y' } } },
        });
      if (method === 'crm.category.list') return Promise.resolve({ result: { categories: [] } });
      if (method === 'user.get') return Promise.resolve({ result: [] });
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(gateway.metadata()).rejects.toThrow('Bitrix title required was invalid');
    callRaw.mockImplementation((method: string) => {
      if (method === 'crm.item.fields') return Promise.resolve({ result: { fields: {} } });
      if (method === 'crm.category.list')
        return Promise.resolve({ result: { categories: [{ id: -1 }] } });
      if (method === 'user.get') return Promise.resolve({ result: [] });
      throw new Error(`Unexpected method ${method}`);
    });
    await expect(gateway.metadata()).rejects.toThrow('Bitrix category id was invalid');
  });
});
