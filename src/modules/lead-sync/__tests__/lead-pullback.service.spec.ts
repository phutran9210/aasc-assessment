import type { LeadSyncConfig } from '@config/index.js';
import { BitrixHttpError } from '@modules/bitrix/index.js';
import type { SheetCell, SheetsClient } from '@modules/google-sheets/index.js';

import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { parseMapping } from '../domain/mapping-schema.js';
import { hashMapping } from '../domain/sync-hash.js';
import { LeadSyncRunItem } from '../entities/lead-sync-run-item.entity.js';
import { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import type { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LeadSyncRunItemRepository } from '../repositories/lead-sync-run-item.repository.js';
import { LeadSyncRunRepository } from '../repositories/lead-sync-run.repository.js';
import { LeadPullback } from '../services/lead-pullback.service.js';
import type { LeadSyncReadiness } from '../services/lead-sync-readiness.service.js';
import type { MappingLoader } from '../services/mapping-loader.service.js';
import { SheetTable } from '../services/sheet-table.service.js';
import { SyncRunner } from '../services/sync-runner.service.js';
import { FakeLeadGateway } from './support/fake-lead-gateway.js';
import { FakeSheetsClient } from './support/fake-sheets-client.js';

const HEADERS = ['Tên khách hàng', 'Email', 'Trạng thái', 'Người phụ trách'];
const MAPPING = parseMapping({
  version: 1,
  defaults: { stageId: 'NEW', assignedById: 1 },
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
    { column: 'Email', field: 'email', type: 'email' },
    {
      column: 'Trạng thái',
      field: 'stageId',
      type: 'enum',
      values: { Mới: 'NEW', 'Đang liên hệ': 'IN_PROCESS', 'Đã xử lý': 'PROCESSED' },
    },
    { column: 'Người phụ trách', field: 'assignedById', type: 'user', values: { 'An Nguyễn': 7 } },
  ],
  dedupe: { keys: ['email'], requireAtLeastOne: true },
});
const ROWS: SheetCell[][] = [
  ['An', 'an@congty.vn', 'Mới', ''],
  ['Bình', 'binh@congty.vn', 'Mới', ''],
];

describe('LeadPullback', () => {
  let dataSource: DataSource;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [LeadSyncRun, LeadSyncRunItem],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dataSource.destroy();
  });

  /** A Sheet whose two rows were already pushed to Bitrix24 by a normal run. */
  const synced = async (direction: LeadSyncConfig['direction'] = 'two-way') => {
    const config: LeadSyncConfig = {
      mappingPath: 'unused',
      cron: undefined,
      timezone: 'Asia/Ho_Chi_Minh',
      direction,
      defaultCountry: 'VN',
      maxRetries: 0,
      logRetentionDays: 30,
      batchSize: 25,
      retryBaseDelayMs: 0,
      lockStaleMs: 120_000,
      publicUrl: undefined,
      outgoingToken: undefined,
      eventDebounceMs: 0,
      eventRetryMs: 0,
    };
    const sheet = new FakeSheetsClient(HEADERS, ROWS);
    const gateway = new FakeLeadGateway();
    gateway.fieldNames = new Set(['name', 'stageId', 'assignedById', 'title', 'originatorId']);
    const runs = new LeadSyncRunRepository(dataSource);
    const readiness = { missing: jest.fn().mockResolvedValue(null) };
    const loader = {
      load: () => Promise.resolve({ mapping: MAPPING, hash: hashMapping(MAPPING) }),
    };
    const table = new SheetTable(sheet as unknown as SheetsClient);
    const shared = [
      readiness as unknown as LeadSyncReadiness,
      loader as unknown as MappingLoader,
      table,
      gateway as unknown as BitrixLeadGateway,
      config,
    ] as const;
    const runner = new SyncRunner(runs, new LeadSyncRunItemRepository(dataSource), ...shared);
    const pullback = new LeadPullback(runs, ...shared);

    const push = async (): Promise<LeadSyncRun> => (await runner.start({ trigger: 'cli' })).done;
    const pull = async (ids: number[] | 'all' = 'all'): Promise<LeadSyncRun> =>
      (await pullback.start(ids, 'webhook')).done;
    await push();
    const leadIdOf = (rowNumber: number): number =>
      Number(sheet.cell(rowNumber, 'Lead ID Bitrix24'));
    const setLead = (rowNumber: number, fields: Record<string, unknown>): void => {
      const lead = gateway.leads.get(leadIdOf(rowNumber));
      if (lead) lead.fields = { ...lead.fields, ...fields };
    };
    return { sheet, gateway, runs, readiness, pullback, push, pull, leadIdOf, setLead };
  };

  it('should write a stage changed in Bitrix24 to the Sheet without it bouncing back', async () => {
    const { sheet, gateway, push, pull, setLead } = await synced();
    setLead(2, { stageId: 'IN_PROCESS' });

    const run = await pull();

    expect(run).toMatchObject({
      trigger: 'webhook',
      status: 'succeeded',
      total: 2,
      updated: 1,
      skipped: 1,
    });
    expect(sheet.cell(2, 'Trạng thái')).toBe('Đang liên hệ');
    expect(sheet.cell(3, 'Trạng thái')).toBe('Mới');
    gateway.calls.write = 0;
    expect(await push()).toMatchObject({ skipped: 2, updated: 0 });
    expect(gateway.calls.write).toBe(0);
  });

  it('should write the assignee and stamp the sync time of the row', async () => {
    const { sheet, pull, setLead } = await synced();
    const before = sheet.cell(3, 'Thời gian đồng bộ cuối');
    setLead(3, { assignedById: 7 });
    jest.useFakeTimers({ now: Date.now() + 60_000, doNotFake: ['nextTick', 'setImmediate'] });

    await pull();
    jest.useRealTimers();

    expect(sheet.cell(3, 'Người phụ trách')).toBe('An Nguyễn');
    expect(sheet.cell(3, 'Thời gian đồng bộ cuối')).not.toBe(before);
  });

  it('should fetch only the leads named by the event', async () => {
    const { sheet, pull, leadIdOf, setLead } = await synced();
    setLead(2, { stageId: 'PROCESSED' });
    setLead(3, { stageId: 'PROCESSED' });

    const run = await pull([leadIdOf(3)]);

    expect(run).toMatchObject({ total: 1, updated: 1 });
    expect(sheet.cell(2, 'Trạng thái')).toBe('Mới');
    expect(sheet.cell(3, 'Trạng thái')).toBe('Đã xử lý');
  });

  it('should let the Sheet win when the row was edited after its last sync', async () => {
    const { sheet, gateway, push, pull, leadIdOf, setLead } = await synced();
    sheet.setCell(2, 'Tên khách hàng', 'An Nguyễn Văn');
    setLead(2, { stageId: 'PROCESSED' });

    const run = await pull();

    expect(run).toMatchObject({ updated: 0, skipped: 2 });
    expect(sheet.cell(2, 'Trạng thái')).toBe('Mới');
    await push();
    expect(gateway.leads.get(leadIdOf(2))?.fields).toMatchObject({
      name: 'An Nguyễn Văn',
      stageId: 'NEW',
    });
  });

  it('should do nothing for a lead that no row is linked to', async () => {
    const { sheet, pull } = await synced();
    const writes = sheet.calls.write;

    const run = await pull([987654]);

    expect(run).toMatchObject({ status: 'succeeded', total: 0, updated: 0 });
    expect(sheet.calls.write).toBe(writes);
  });

  it('should refuse to run while LEAD_SYNC_DIRECTION is sheet-to-bitrix', async () => {
    const { pullback } = await synced('sheet-to-bitrix');

    await expect(pullback.start('all', 'pull')).rejects.toThrow(LeadSyncConfigError);
    await expect(pullback.start('all', 'pull')).rejects.toThrow(/LEAD_SYNC_DIRECTION=two-way/);
  });

  it('should refuse to start while another run holds the lock', async () => {
    const { pullback, runs } = await synced();
    await runs.acquire('cli', false, 120_000);

    await expect(pullback.start('all', 'pull')).rejects.toThrow(LeadSyncBusyError);
  });

  it('should end the run as failed, with the reason, when the Sheet cannot be read', async () => {
    const { sheet, pull } = await synced();
    jest.spyOn(sheet, 'batchGet').mockRejectedValue(new Error('Google từ chối truy cập'));

    const run = await pull();

    expect(run).toMatchObject({ status: 'failed', stopReason: 'Google từ chối truy cập' });
  });

  it('should explain a portal whose plan blocks the REST API the same way a normal run does', async () => {
    const { gateway, pull } = await synced();
    jest
      .spyOn(gateway, 'getLeads')
      .mockRejectedValue(
        new BitrixHttpError(
          'Feature is not available on the current plan.',
          'FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN',
          403,
        ),
      );

    const run = await pull();

    expect(run.status).toBe('failed');
    expect(run.stopReason).toMatch(/^Gói dịch vụ của portal Bitrix24 không cho dùng REST API/);
  });
});
