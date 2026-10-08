import { NotFoundException } from '@nestjs/common';
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
});
