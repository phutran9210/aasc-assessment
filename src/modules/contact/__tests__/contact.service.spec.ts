import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { bitrixConfig } from '@config/index.js';

import { BitrixApiService } from '@modules/bitrix/index.js';

import { ContactService } from '../services/contact.service.js';

describe('ContactService', () => {
  const api = { callBitrixApi: jest.fn(), callBitrixApiWithTotal: jest.fn() };
  let service: ContactService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: BitrixApiService, useValue: api },
        { provide: bitrixConfig.KEY, useValue: { requisitePresetId: 9 } },
      ],
    }).compile();
    service = moduleRef.get(ContactService);
  });

  /** Answers each Bitrix24 list method with a fixed result; `total` is its length. */
  const mockLists = (results: Record<string, unknown>): void => {
    api.callBitrixApiWithTotal.mockImplementation((method: string) => {
      const result = results[method] ?? [];
      const rows = Array.isArray(result) ? result : (result as { items: unknown[] }).items;
      return Promise.resolve({ result, total: rows.length });
    });
  };

  it('should return one paginated page with related data', async () => {
    mockLists({
      'crm.item.list': {
        items: [{ id: 1, name: 'A', fm: [{ id: 2, typeId: 'PHONE', value: '1' }] }],
      },
      'crm.requisite.list': [{ ID: '3', ENTITY_ID: '1', PRESET_ID: '9' }],
      'crm.address.list': [{ ENTITY_ID: '3', ADDRESS_1: 'W', REGION: 'D', PROVINCE: 'P' }],
      'crm.requisite.bankdetail.list': [
        { ID: '5', ENTITY_ID: '3', RQ_BANK_NAME: 'B', RQ_ACC_NUM: 'N' },
      ],
    });
    await expect(service.findAll({ page: 1, limit: 10 })).resolves.toMatchObject({
      data: [{ id: '1', name: 'A', phone: '1', address: { ward: 'W' }, bank: { bankName: 'B' } }],
      meta: { total: 1, page: 1, limit: 10 },
    });
    expect(api.callBitrixApiWithTotal).toHaveBeenCalledWith(
      'crm.item.list',
      expect.objectContaining({ start: 0 }),
    );
  });

  it('should create contact before requisite address and bank detail', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 10 } })
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(40);
    await service.create({
      name: 'A',
      address: { ward: 'W', district: 'D', province: 'P' },
      bank: { bankName: 'B', accountNumber: 'N' },
    });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.add',
      'crm.requisite.add',
      'crm.address.add',
      'crm.requisite.bankdetail.add',
    ]);
    expect(api.callBitrixApi).toHaveBeenCalledWith('crm.requisite.add', {
      fields: expect.objectContaining({ ENTITY_ID: 10, PRESET_ID: 9, NAME: 'A' }),
    });
  });

  it('should reject a Bitrix create response without a usable contact ID', async () => {
    api.callBitrixApi.mockResolvedValueOnce(null);

    await expect(service.create({ name: 'Missing ID' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('should compensate created objects when bank detail creation fails', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 10 } })
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('bank'))
      .mockResolvedValue(undefined);
    await expect(
      service.create({
        name: 'A',
        address: { ward: 'W', district: 'D', province: 'P' },
        bank: { bankName: 'B', accountNumber: 'N' },
      }),
    ).rejects.toThrow();
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.add',
      'crm.requisite.add',
      'crm.address.add',
      'crm.requisite.bankdetail.add',
      'crm.requisite.delete',
      'crm.item.delete',
    ]);
  });

  it('should throw not found when the remote contact is missing', async () => {
    api.callBitrixApi.mockResolvedValue({ item: null });
    await expect(service.update('99', { name: 'A' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should report the contact as missing when Bitrix24 answers NOT_FOUND', async () => {
    api.callBitrixApi.mockRejectedValue(new NotFoundException('Bitrix24 không tìm thấy dữ liệu'));
    await expect(service.remove('99')).rejects.toThrow('Contact không tồn tại');
  });

  it('should cap a page at the requested limit and report the portal total', async () => {
    mockLists({ 'crm.item.list': { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
    const page = await service.findAll({ page: 1, limit: 2 });
    expect(page.data.map((contact) => contact.id)).toEqual(['1', '2']);
    expect(page.meta).toMatchObject({ total: 3, totalPages: 2 });
  });

  it('should read page 2 from the same Bitrix24 block instead of sending a raw offset', async () => {
    mockLists({ 'crm.item.list': { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });

    const page = await service.findAll({ page: 2, limit: 2 });

    expect(page.data.map((contact) => contact.id)).toEqual(['3']);
    expect(api.callBitrixApiWithTotal).toHaveBeenCalledWith(
      'crm.item.list',
      expect.objectContaining({ start: 0 }),
    );
  });

  it('should fetch the next Bitrix24 block when a page crosses the 50-item boundary', async () => {
    const block = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: from + index }));
    api.callBitrixApiWithTotal.mockImplementation((method: string, payload: { start?: number }) => {
      if (method !== 'crm.item.list') return Promise.resolve({ result: [], total: 0 });
      const items = payload.start === 0 ? block(1, 50) : block(51, 20);
      return Promise.resolve({ result: { items }, total: 70 });
    });

    const page = await service.findAll({ page: 2, limit: 30 });

    expect(page.data.map((contact) => contact.id)).toEqual(block(31, 30).map((x) => String(x.id)));
    const itemCalls = api.callBitrixApiWithTotal.mock.calls.filter(
      ([method]) => method === 'crm.item.list',
    );
    expect(itemCalls.map(([, payload]) => payload.start)).toEqual([0, 50]);
  });

  it('should load related data for a whole page with one call per list method', async () => {
    mockLists({
      'crm.item.list': { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      'crm.requisite.list': [
        { ID: '11', ENTITY_ID: '1' },
        { ID: '13', ENTITY_ID: '3' },
        { ID: '14', ENTITY_ID: '3' },
        { ID: '12', ENTITY_ID: '2', ACTIVE: 'N' },
      ],
      'crm.address.list': [{ ENTITY_ID: '13', ADDRESS_1: 'W3', REGION: 'D3', PROVINCE: 'P3' }],
      'crm.requisite.bankdetail.list': [
        { ID: '22', ENTITY_ID: '11', RQ_BANK_NAME: 'Later', RQ_ACC_NUM: '2' },
        { ID: '21', ENTITY_ID: '11', RQ_BANK_NAME: 'First', RQ_ACC_NUM: '1' },
      ],
    });

    const page = await service.findAll({ page: 1, limit: 10 });

    expect(page.data).toMatchObject([
      { id: '1', address: null, bank: { bankName: 'First', accountNumber: '1' } },
      { id: '2', address: null, bank: null },
      { id: '3', address: { ward: 'W3', district: 'D3', province: 'P3' }, bank: null },
    ]);
    expect(api.callBitrixApiWithTotal.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.list',
      'crm.requisite.list',
      'crm.address.list',
      'crm.requisite.bankdetail.list',
    ]);
    expect(api.callBitrixApiWithTotal).toHaveBeenCalledWith(
      'crm.requisite.list',
      expect.objectContaining({ filter: expect.objectContaining({ ENTITY_ID: [1, 2, 3] }) }),
    );
    expect(api.callBitrixApiWithTotal).toHaveBeenCalledWith(
      'crm.address.list',
      expect.objectContaining({ filter: expect.objectContaining({ ENTITY_ID: [11, 13] }) }),
    );
  });

  it('should skip the related lookups when the page is empty', async () => {
    mockLists({ 'crm.item.list': { items: [] } });

    await service.findAll({ page: 1, limit: 10 });

    expect(api.callBitrixApiWithTotal).toHaveBeenCalledTimes(1);
  });

  it('should use an empty page when Bitrix omits its items and total fields', async () => {
    api.callBitrixApiWithTotal.mockResolvedValue({ result: {} });
    await expect(service.findAll({ page: 1, limit: 10 })).resolves.toMatchObject({
      data: [],
      meta: { total: 0, page: 1, limit: 10 },
    });
  });

  it('should skip related lookups when no requisite preset is configured', async () => {
    (service as unknown as { config: { requisitePresetId?: number } }).config.requisitePresetId =
      undefined;
    api.callBitrixApiWithTotal.mockResolvedValue({
      result: { items: [{ id: 1, name: 'A' }] },
      total: 1,
    });

    await expect(service.findAll({ page: 1, limit: 10 })).resolves.toMatchObject({
      data: [{ id: '1', address: null, bank: null }],
    });
    expect(api.callBitrixApi).not.toHaveBeenCalled();
  });

  it('should follow multiple requisite pages and accept an items response object', async () => {
    const requisites = Array.from({ length: 50 }, (_, index) => ({
      ID: String(index + 1),
      ENTITY_ID: String(index + 100),
    }));
    requisites[0] = { ID: '1', ENTITY_ID: '1' };
    api.callBitrixApiWithTotal.mockImplementation((method: string, query: { start?: number }) => {
      if (method === 'crm.item.list') {
        return Promise.resolve({ result: { items: [{ id: 1, name: 'A' }] }, total: 1 });
      }
      if (method === 'crm.requisite.list') {
        return Promise.resolve({
          result: query.start === 0 ? requisites : { items: [{ ID: '51', ENTITY_ID: '1' }] },
          total: 51,
        });
      }
      return Promise.resolve({ result: [], total: 0 });
    });

    await service.findAll({ page: 1, limit: 10 });
    expect(
      api.callBitrixApiWithTotal.mock.calls
        .filter(([method]) => method === 'crm.requisite.list')
        .map(([, query]) => query.start),
    ).toEqual([0, 50]);
  });

  it('should create related records when a requisite has no address or bank yet', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'A' } })
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ item: { id: 1, name: 'A' } })
      .mockResolvedValueOnce([]);
    await service.update('1', {
      address: { ward: 'W', district: 'D', province: 'P' },
      bank: { bankName: 'B', accountNumber: 'N' },
    });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain('crm.address.add');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain(
      'crm.requisite.bankdetail.add',
    );
  });

  it('should update existing related address and bank records in place', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'Before' } })
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValueOnce([{ ID: '10', ADDRESS_1: 'Old' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ ID: '11', RQ_BANK_NAME: 'Old bank' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ item: { id: 1, name: 'After' } })
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValueOnce([{ ID: '10', ADDRESS_1: 'New ward' }])
      .mockResolvedValueOnce([{ ID: '11', RQ_BANK_NAME: 'New bank' }]);

    await expect(
      service.update('1', {
        address: { ward: 'New ward', district: 'New district', province: 'New province' },
        bank: { bankName: 'New bank', accountNumber: '123' },
      }),
    ).resolves.toMatchObject({ id: '1', address: { ward: 'New ward' } });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain('crm.address.update');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain(
      'crm.requisite.bankdetail.update',
    );
  });

  it('should accept lowercase IDs returned by requisite and related detail endpoints', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'A' } })
      .mockResolvedValueOnce([{ id: '9' }])
      .mockResolvedValueOnce([{ id: '10' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: '11' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ item: { id: 1, name: 'A' } })
      .mockResolvedValueOnce([{ id: '9' }])
      .mockResolvedValueOnce([{ id: '10' }])
      .mockResolvedValueOnce([{ id: '11' }]);

    await service.update('1', {
      address: { ward: 'W', district: 'D', province: 'P' },
      bank: { bankName: 'B', accountNumber: 'N' },
    });

    expect(api.callBitrixApi).toHaveBeenCalledWith('crm.requisite.bankdetail.update', {
      id: 11,
      fields: expect.objectContaining({ ENTITY_ID: 9 }),
    });
  });

  it('should skip the contact update when the request has no changed fields or related records', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'Unchanged' } })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ item: { id: 1, name: 'Unchanged' } })
      .mockResolvedValueOnce([]);

    await expect(service.update('1', {})).resolves.toMatchObject({
      id: '1',
      name: 'Unchanged',
      address: null,
      bank: null,
    });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.requisite.list',
      'crm.item.get',
      'crm.requisite.list',
    ]);
  });

  it('should delete the requisite before deleting its contact', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValue(undefined);

    await service.remove('1');

    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.requisite.list',
      'crm.requisite.delete',
      'crm.item.delete',
    ]);
  });

  it('should delete the contact directly when it has no requisite', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await service.remove('1');

    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.requisite.list',
      'crm.item.delete',
    ]);
  });

  it('should fail related creation without a configured requisite preset and still clean up the contact', async () => {
    (service as unknown as { config: { requisitePresetId?: number } }).config.requisitePresetId =
      undefined;
    api.callBitrixApi.mockResolvedValueOnce({ id: '25' }).mockResolvedValue(undefined);
    await expect(
      service.create({ name: 'A', address: { ward: 'W', district: 'D', province: 'P' } }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(api.callBitrixApi).toHaveBeenLastCalledWith('crm.item.delete', {
      entityTypeId: 3,
      id: 25,
    });
  });

  it('should create a contact without optional related records and reject a missing remote ID', async () => {
    api.callBitrixApi.mockResolvedValueOnce({ id: '25' });
    await expect(service.create({ name: 'Simple' })).resolves.toMatchObject({
      id: '25',
      name: 'Simple',
      address: null,
      bank: null,
    });
    api.callBitrixApi.mockResolvedValueOnce({});
    await expect(service.create({ name: 'Broken' })).rejects.toThrow(ServiceUnavailableException);
  });

  it('should compensate every related object if building the response fails after the bank was created', async () => {
    const remoteItem = {
      id: 25,
      get name(): never {
        throw new Error('malformed remote contact');
      },
    };
    api.callBitrixApi
      .mockResolvedValueOnce({ item: remoteItem })
      .mockResolvedValueOnce({ ID: '30' })
      .mockResolvedValueOnce({ id: '40' })
      .mockResolvedValue(undefined);
    await expect(
      service.create({ name: 'A', bank: { bankName: 'B', accountNumber: 'N' } }),
    ).rejects.toThrow('malformed remote contact');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.add',
      'crm.requisite.add',
      'crm.requisite.bankdetail.add',
      'crm.requisite.bankdetail.delete',
      'crm.requisite.delete',
      'crm.item.delete',
    ]);
  });

  it('should use ID fallbacks and tolerate remote list methods returning items objects', async () => {
    api.callBitrixApi.mockResolvedValueOnce({ item: '26' });
    await expect(service.create({ name: 'String result' })).resolves.toMatchObject({ id: '26' });

    api.callBitrixApi.mockResolvedValueOnce({ ID: '27' });
    await expect(service.create({ name: 'ID result' })).resolves.toMatchObject({ id: '27' });

    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ items: [{ id: '9', ACTIVE: 'Y' }] })
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce({ items: [{ id: '9', ACTIVE: 'Y' }] })
      .mockResolvedValueOnce({ items: [{ id: '10', ADDRESS_1: 'Ward' }] })
      .mockResolvedValueOnce({ items: [{ id: '11', NAME: 'Bank', RQ_ACC_NUM: '1' }] });
    await service.update('1', { name: 'Changed' });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain(
      'crm.requisite.bankdetail.list',
    );
  });

  it('should propagate non-not-found lookup failures and skip requisite calls without a preset', async () => {
    api.callBitrixApi.mockRejectedValueOnce(new Error('Bitrix offline'));
    await expect(service.remove('1')).rejects.toThrow('Bitrix offline');
    (service as unknown as { config: { requisitePresetId?: number } }).config.requisitePresetId =
      undefined;
    api.callBitrixApi.mockReset();
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce({ item: { id: 1 } });
    await service.remove('1');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.item.delete',
    ]);
  });

  it('should skip empty contact updates and create missing related records when adding address or bank', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'Before' } })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce({ item: { id: 1, name: 'Before' } })
      .mockResolvedValueOnce([]);
    await service.update('1', {
      address: { ward: 'W', district: 'D', province: 'P' },
      bank: { bankName: 'B', accountNumber: 'N' },
    });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.requisite.list',
      'crm.requisite.add',
      'crm.address.add',
      'crm.requisite.bankdetail.add',
      'crm.item.get',
      'crm.requisite.list',
    ]);
  });

  it('should update existing related records and delete requisite before contact', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1, name: 'Before' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValueOnce([{ ID: '10', ADDRESS_1: 'Old' }])
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([{ ID: '11', RQ_BANK_NAME: 'Old' }])
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ item: { id: 1, name: 'After' } })
      .mockResolvedValueOnce([{ ID: '9' }])
      .mockResolvedValueOnce([{ ID: '10', ADDRESS_1: 'New' }])
      .mockResolvedValueOnce([{ ID: '11', RQ_BANK_NAME: 'New' }]);
    await service.update('1', {
      name: 'After',
      address: { ward: 'New', district: 'D', province: 'P' },
      bank: { bankName: 'New', accountNumber: '2' },
    });
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain('crm.address.update');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toContain(
      'crm.requisite.bankdetail.update',
    );

    api.callBitrixApi.mockReset();
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 1 } })
      .mockResolvedValueOnce([{ ID: '9', id: '8' }])
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    await service.remove('1');
    expect(api.callBitrixApi.mock.calls.map(([method]) => method)).toEqual([
      'crm.item.get',
      'crm.requisite.list',
      'crm.requisite.delete',
      'crm.item.delete',
    ]);
  });

  it('sorts remote requisite and bank records when IDs use either casing', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce([{ id: '12' }, { ID: '3' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '22' }, { ID: '4' }]);
    mockLists({
      'crm.item.list': { items: [{ id: 1 }] },
      'crm.requisite.list': [{ id: '12' }, { ID: '3' }],
      'crm.address.list': [],
      'crm.requisite.bankdetail.list': [{ id: '22' }, { ID: '4' }],
    });
    await service.findAll({ page: 1, limit: 10 });
    expect(api.callBitrixApiWithTotal).toHaveBeenCalledWith(
      'crm.requisite.list',
      expect.objectContaining({ filter: expect.objectContaining({ ENTITY_ID: [1] }) }),
    );
  });

  it('should compensate a failed build even when cleanup also fails', async () => {
    api.callBitrixApi
      .mockResolvedValueOnce({ item: { id: 10 } })
      .mockResolvedValueOnce(20)
      .mockRejectedValueOnce(new Error('address'))
      .mockRejectedValueOnce('cleanup failed');
    await expect(
      service.create({ name: 'A', address: { ward: 'W', district: 'D', province: 'P' } }),
    ).rejects.toThrow('address');
  });
});
