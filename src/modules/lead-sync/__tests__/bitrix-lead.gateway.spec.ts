import type { LeadSyncConfig } from '@config/index.js';
import { BitrixHttpError } from '@modules/bitrix/index.js';
import type { BitrixApiService, BitrixBatchService } from '@modules/bitrix/index.js';

import { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import type { DuplicateQuery, LeadWriteOp, ValidRow } from '../types/index.js';

const config = { maxRetries: 4 } as LeadSyncConfig;
const READ = { retryTransient: true, maxRetries: 4 };

const row = (rowNumber: number): ValidRow => ({
  kind: 'valid',
  rowNumber,
  fields: { name: `Khách ${rowNumber}`, title: `Khách ${rowNumber}` },
  email: `khach${rowNumber}@example.com`,
  phone: undefined,
  hash: 'h',
});

describe('BitrixLeadGateway', () => {
  const api = { callRaw: jest.fn() };
  const batch = { execute: jest.fn() };
  let gateway: BitrixLeadGateway;

  beforeEach(() => {
    jest.resetAllMocks();
    gateway = new BitrixLeadGateway(
      api as unknown as BitrixApiService,
      batch as unknown as BitrixBatchService,
      config,
    );
  });

  describe('usesLeads', () => {
    it('should report classic CRM mode as using leads, retrying temporary failures', async () => {
      api.callRaw.mockResolvedValue({ result: 1 });

      await expect(gateway.usesLeads()).resolves.toBe(true);
      expect(api.callRaw).toHaveBeenCalledWith('crm.settings.mode.get', {}, READ);
    });

    it('should report simple CRM mode as not using leads', async () => {
      api.callRaw.mockResolvedValue({ result: 2 });

      await expect(gateway.usesLeads()).resolves.toBe(false);
    });
  });

  describe('getFieldNames', () => {
    it('should read the lead fields with original UF names, retrying temporary failures', async () => {
      api.callRaw.mockResolvedValue({
        result: { fields: { title: {}, companyTitle: {}, UF_CRM_1700000000: {} } },
      });

      await expect(gateway.getFieldNames()).resolves.toEqual(
        new Set(['title', 'companyTitle', 'UF_CRM_1700000000']),
      );
      expect(api.callRaw).toHaveBeenCalledWith(
        'crm.item.fields',
        { entityTypeId: 1, useOriginalUfNames: 'Y' },
        READ,
      );
    });
  });

  describe('findDuplicates', () => {
    const queries: DuplicateQuery[] = [
      { key: 'r12e', type: 'EMAIL', value: 'a@x.vn' },
      { key: 'r12p', type: 'PHONE', value: '+84901234567' },
      { key: 'r13p', type: 'PHONE', value: '+84911111111' },
    ];

    it('should send one findbycomm command per value and return lead ids per key', async () => {
      batch.execute.mockResolvedValue({
        results: new Map<string, unknown>([
          ['r12e', { LEAD: [512, '345'] }],
          ['r12p', []],
          ['r13p', { CONTACT: [7] }],
        ]),
        errors: new Map(),
      });

      await expect(gateway.findDuplicates(queries)).resolves.toEqual(
        new Map([
          ['r12e', [345, 512]],
          ['r12p', []],
          ['r13p', []],
        ]),
      );
      expect(batch.execute).toHaveBeenCalledWith(
        [
          {
            key: 'r12e',
            method: 'crm.duplicate.findbycomm',
            params: { entity_type: 'LEAD', type: 'EMAIL', values: ['a@x.vn'] },
          },
          {
            key: 'r12p',
            method: 'crm.duplicate.findbycomm',
            params: { entity_type: 'LEAD', type: 'PHONE', values: ['+84901234567'] },
          },
          {
            key: 'r13p',
            method: 'crm.duplicate.findbycomm',
            params: { entity_type: 'LEAD', type: 'PHONE', values: ['+84911111111'] },
          },
        ],
        READ,
      );
    });

    it('should fail the whole search when one command fails: guessing "no duplicate" creates one', async () => {
      batch.execute.mockResolvedValue({
        results: new Map(),
        errors: new Map([['r12e', { code: 'QUERY_LIMIT_EXCEEDED', message: 'Too many requests' }]]),
      });

      await expect(gateway.findDuplicates(queries)).rejects.toMatchObject({
        code: 'QUERY_LIMIT_EXCEEDED',
        status: 503,
      });

      batch.execute.mockResolvedValue({
        results: new Map(),
        errors: new Map([['r12e', { code: 'ACCESS_DENIED', message: 'Access denied' }]]),
      });
      await expect(gateway.findDuplicates(queries)).rejects.toBeInstanceOf(BitrixHttpError);
      await expect(gateway.findDuplicates(queries)).rejects.toMatchObject({ status: 400 });
    });

    it('should split more than 50 queries over several batches', async () => {
      batch.execute.mockResolvedValue({ results: new Map(), errors: new Map() });
      const many = Array.from({ length: 51 }, (_unused, index) => ({
        key: `r${index}e`,
        type: 'EMAIL' as const,
        value: `k${index}@x.vn`,
      }));

      await gateway.findDuplicates(many);

      expect(batch.execute.mock.calls.map(([commands]) => commands.length)).toEqual([50, 1]);
    });

    it('should call nothing for no queries', async () => {
      await expect(gateway.findDuplicates([])).resolves.toEqual(new Map());
      expect(batch.execute).not.toHaveBeenCalled();
    });
  });

  describe('getLeads', () => {
    it('should read the given leads in one list call and index them by id', async () => {
      api.callRaw.mockResolvedValue({
        result: { items: [{ id: 345, fm: [] }, { id: '512' }] },
      });

      const leads = await gateway.getLeads([345, 512]);

      expect([...leads.keys()]).toEqual([345, 512]);
      expect(api.callRaw).toHaveBeenCalledWith(
        'crm.item.list',
        { entityTypeId: 1, filter: { '@id': [345, 512] }, select: ['*'], useOriginalUfNames: 'Y' },
        READ,
      );
    });

    it('should call nothing for no ids', async () => {
      await expect(gateway.getLeads([])).resolves.toEqual(new Map());
      expect(api.callRaw).not.toHaveBeenCalled();
    });
  });

  describe('write', () => {
    const ops: LeadWriteOp[] = [
      { row: row(12), action: 'update', leadId: 345, otherMatches: [], current: { id: 345 } },
      { row: row(13), action: 'create', otherMatches: [] },
      { row: row(14), action: 'create', otherMatches: [] },
    ];

    it('should send add and update commands keyed by row, without transient retry', async () => {
      batch.execute.mockResolvedValue({ results: new Map(), errors: new Map() });

      await gateway.write(ops);

      expect(batch.execute).toHaveBeenCalledTimes(1);
      const [commands, options] = batch.execute.mock.calls[0];
      expect(options).toBeUndefined();
      expect(commands).toEqual([
        {
          key: 'u12',
          method: 'crm.item.update',
          params: {
            entityTypeId: 1,
            id: 345,
            fields: {
              name: 'Khách 12',
              title: 'Khách 12',
              fm: { n0: { typeId: 'EMAIL', valueType: 'WORK', value: 'khach12@example.com' } },
            },
            useOriginalUfNames: 'Y',
          },
        },
        {
          key: 'c13',
          method: 'crm.item.add',
          params: {
            entityTypeId: 1,
            fields: {
              name: 'Khách 13',
              title: 'Khách 13',
              fm: [{ typeId: 'EMAIL', valueType: 'WORK', value: 'khach13@example.com' }],
              originatorId: 'google-sheets',
            },
            useOriginalUfNames: 'Y',
          },
        },
        expect.objectContaining({ key: 'c14', method: 'crm.item.add' }),
      ]);
    });

    it('should report the outcome of every row: new id, updated id, or the Bitrix24 error', async () => {
      batch.execute.mockResolvedValue({
        results: new Map<string, unknown>([
          ['c13', { item: { id: 912 } }],
          ['u12', { item: { id: 345 } }],
        ]),
        errors: new Map([['c14', { code: 'INVALID_ARG_VALUE', message: 'Invalid stageId' }]]),
      });

      await expect(gateway.write(ops)).resolves.toEqual(
        new Map([
          [12, { ok: true, leadId: 345 }],
          [13, { ok: true, leadId: 912 }],
          [14, { ok: false, code: 'INVALID_ARG_VALUE', message: 'Invalid stageId' }],
        ]),
      );
    });

    it('should fail a create whose answer carries no id', async () => {
      batch.execute.mockResolvedValue({
        results: new Map<string, unknown>([['c13', { item: {} }]]),
        errors: new Map(),
      });

      const results = await gateway.write([ops[1]]);

      expect(results.get(13)).toMatchObject({ ok: false, code: 'ID_MISSING' });
    });

    it('should let a batch failure through unchanged, so the caller can re-plan', async () => {
      const timeout = new BitrixHttpError('timeout', undefined, undefined, true);
      batch.execute.mockRejectedValue(timeout);

      await expect(gateway.write(ops)).rejects.toBe(timeout);
    });

    it('should call nothing for no operations', async () => {
      await expect(gateway.write([])).resolves.toEqual(new Map());
      expect(batch.execute).not.toHaveBeenCalled();
    });
  });
});
