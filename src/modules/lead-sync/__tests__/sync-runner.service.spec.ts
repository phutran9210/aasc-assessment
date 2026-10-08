import type { LeadSyncConfig } from '@config/index.js';
import { BitrixHttpError } from '@modules/bitrix/index.js';
import { SheetsError } from '@modules/google-sheets/index.js';
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
import type { LeadSyncReadiness } from '../services/lead-sync-readiness.service.js';
import type { MappingLoader } from '../services/mapping-loader.service.js';
import { SheetTable } from '../services/sheet-table.service.js';
import { SyncRunner } from '../services/sync-runner.service.js';
import type { RunOptions } from '../services/sync-runner.service.js';
import type { LeadMapping } from '../types/index.js';
import { FakeLeadGateway } from './support/fake-lead-gateway.js';
import { FakeSheetsClient } from './support/fake-sheets-client.js';

const BUSINESS = [
  'Tên khách hàng',
  'Email',
  'Số điện thoại',
  'Công ty',
  'Ngân sách dự kiến',
  'Trạng thái',
];
const TECHNICAL = [
  'Trạng thái đồng bộ',
  'Lead ID Bitrix24',
  'Thời gian đồng bộ cuối',
  'Thông báo lỗi',
  'Sync Hash',
];

const MAPPING = parseMapping({
  version: 1,
  titleTemplate: '{Tên khách hàng} - {Công ty}',
  defaults: { stageId: 'NEW' },
  fields: [
    { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
    { column: 'Email', field: 'email', type: 'email' },
    { column: 'Số điện thoại', field: 'phone', type: 'phone' },
    { column: 'Công ty', field: 'companyTitle', type: 'string' },
    { column: 'Ngân sách dự kiến', field: 'opportunity', type: 'number' },
    {
      column: 'Trạng thái',
      field: 'stageId',
      type: 'enum',
      values: { Mới: 'NEW', 'Đang liên hệ': 'IN_PROCESS' },
    },
  ],
});

const emailOf = (n: number): string => `khach${n}@example.com`;
const phoneOf = (n: number): string => `+849${String(n).padStart(8, '0')}`;
/** Sheet row for customer `n`. Customer n sits in sheet row n + 1 when rows start at n = 1. */
const lead = (n: number): SheetCell[] => [
  `Khách ${n}`,
  emailOf(n),
  `09${String(n).padStart(8, '0')}`,
  'ACME',
  1000000,
  'Mới',
];
const leads = (count: number): SheetCell[][] =>
  Array.from({ length: count }, (_unused, index) => lead(index + 1));

const timeout = (): BitrixHttpError => new BitrixHttpError('timeout', undefined, undefined, true);

type Harness = {
  runner: SyncRunner;
  sheet: FakeSheetsClient;
  gateway: FakeLeadGateway;
  runs: LeadSyncRunRepository;
  items: LeadSyncRunItemRepository;
  readiness: { missing: jest.Mock };
  run: (options?: Partial<RunOptions>) => Promise<LeadSyncRun>;
};

describe('SyncRunner', () => {
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

  const harness = (
    rows: SheetCell[][],
    options: {
      headers?: string[];
      mapping?: LeadMapping;
      batchSize?: number;
      maxRetries?: number;
    } = {},
  ): Harness => {
    const config: LeadSyncConfig = {
      mappingPath: 'unused',
      cron: undefined,
      timezone: 'Asia/Ho_Chi_Minh',
      direction: 'sheet-to-bitrix',
      defaultCountry: 'VN',
      maxRetries: options.maxRetries ?? 2,
      logRetentionDays: 30,
      batchSize: options.batchSize ?? 25,
      retryBaseDelayMs: 0,
      lockStaleMs: 120_000,
      publicUrl: undefined,
      outgoingToken: undefined,
      eventDebounceMs: 0,
      eventRetryMs: 0,
    };
    const mapping = options.mapping ?? MAPPING;
    const sheet = new FakeSheetsClient(options.headers ?? BUSINESS, rows);
    const gateway = new FakeLeadGateway();
    const runs = new LeadSyncRunRepository(dataSource);
    const items = new LeadSyncRunItemRepository(dataSource);
    const readiness = { missing: jest.fn().mockResolvedValue(null) };
    const loader = { load: () => Promise.resolve({ mapping, hash: hashMapping(mapping) }) };
    const runner = new SyncRunner(
      runs,
      items,
      readiness as unknown as LeadSyncReadiness,
      loader as unknown as MappingLoader,
      new SheetTable(sheet as unknown as SheetsClient),
      gateway as unknown as BitrixLeadGateway,
      config,
    );
    const run = async (runOptions: Partial<RunOptions> = {}): Promise<LeadSyncRun> =>
      (await runner.start({ trigger: 'cli', ...runOptions })).done;

    return { runner, sheet, gateway, runs, items, readiness, run };
  };

  const counters = (run: LeadSyncRun) => ({
    total: run.total,
    created: run.created,
    updated: run.updated,
    skipped: run.skipped,
    failed: run.failed,
  });

  describe('TC1: tạo lead mới', () => {
    it('should create the lead and write its ID, status, time and hash back to the row', async () => {
      const { run, sheet, gateway, items } = harness([lead(1)]);

      const result = await run();

      expect(result.status).toBe('succeeded');
      expect(counters(result)).toEqual({ total: 1, created: 1, updated: 0, skipped: 0, failed: 0 });
      expect(gateway.calls.write).toBe(1);
      expect([...gateway.leads.values()]).toEqual([
        {
          id: 1000,
          email: emailOf(1),
          phone: phoneOf(1),
          fields: {
            stageId: 'NEW',
            name: 'Khách 1',
            companyTitle: 'ACME',
            opportunity: 1000000,
            title: 'Khách 1 - ACME',
          },
        },
      ]);
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe('1000');
      expect(sheet.cell(2, 'Trạng thái đồng bộ')).toBe('Đã đồng bộ');
      expect(sheet.cell(2, 'Thời gian đồng bộ cuối')).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
      expect(sheet.cell(2, 'Thông báo lỗi')).toBe('');
      expect(sheet.cell(2, 'Sync Hash')).toMatch(/^v1:[0-9a-f]{64}$/);
      await expect(items.findByRun(result.id)).resolves.toMatchObject([
        { rowNumber: 2, action: 'create', leadId: '1000', attempts: 1 },
      ]);
    });

    it('should add the technical columns on the first run and hide the two internal ones', async () => {
      const { run, sheet } = harness([lead(1)]);

      await run();

      expect(sheet.grid[0]).toEqual([...BUSINESS, ...TECHNICAL]);
      expect(sheet.structureRequests).toHaveLength(2);
    });

    it('should succeed with nothing to do on a sheet that has only the header row', async () => {
      const { run, gateway } = harness([]);

      const result = await run();

      expect(result.status).toBe('succeeded');
      expect(counters(result)).toEqual({ total: 0, created: 0, updated: 0, skipped: 0, failed: 0 });
      expect(gateway.calls.write).toBe(0);
    });

    it('should not count blank rows between customers', async () => {
      const { run } = harness([lead(1), [], ['', '', '', '', '', ''], lead(2)]);

      const result = await run();

      expect(counters(result)).toMatchObject({ total: 2, created: 2 });
    });
  });

  describe('TC2: cập nhật lead', () => {
    it('should update the lead when a cell changes, then skip it when nothing changes', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      await run();
      const firstHash = sheet.cell(2, 'Sync Hash');

      sheet.setCell(2, 'Ngân sách dự kiến', 2500000);
      const second = await run();

      expect(counters(second)).toEqual({ total: 1, created: 0, updated: 1, skipped: 0, failed: 0 });
      expect(gateway.leads.get(1000)?.fields.opportunity).toBe(2500000);
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(2, 'Sync Hash')).not.toBe(firstHash);

      const third = await run();

      expect(counters(third)).toEqual({ total: 1, created: 0, updated: 0, skipped: 1, failed: 0 });
      expect(gateway.calls.write).toBe(2);
    });

    it('should not update when only the formatting of a cell changed', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      await run();

      sheet.setCell(2, 'Số điện thoại', '+84 900 000 001');
      sheet.setCell(2, 'Tên khách hàng', '  Khách 1 ');
      const second = await run();

      expect(second.skipped).toBe(1);
      expect(gateway.calls.write).toBe(1);
    });

    it('should force one row when the admin sets its status to "Chờ xử lý"', async () => {
      const { run, sheet } = harness(leads(2));
      await run();

      sheet.setCell(3, 'Trạng thái đồng bộ', 'Chờ xử lý');
      const second = await run();

      expect(counters(second)).toMatchObject({ updated: 1, skipped: 1 });
      expect(sheet.cell(3, 'Trạng thái đồng bộ')).toBe('Đã đồng bộ');
    });

    it('should send every row again with force', async () => {
      const { run } = harness(leads(3));
      await run();

      expect(counters(await run({ force: true }))).toMatchObject({ updated: 3, skipped: 0 });
    });

    it('should report a lead deleted in Bitrix24 instead of creating it again', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      await run();
      gateway.leads.clear();
      sheet.setCell(2, 'Công ty', 'ACME 2');

      const second = await run();

      expect(second.status).toBe('partial');
      expect(gateway.leads.size).toBe(0);
      expect(sheet.cell(2, 'Trạng thái đồng bộ')).toBe('Lỗi');
      expect(sheet.cell(2, 'Thông báo lỗi')).toBe(
        'Lead không còn tồn tại trong Bitrix24; xóa nội dung ô Lead ID nếu muốn tạo lại',
      );
    });
  });

  describe('idempotency', () => {
    it('should send no write to Bitrix24 and to the Sheet on a second run', async () => {
      const { run, sheet, gateway } = harness(leads(3));
      await run();
      const sheetWrites = sheet.calls.write;

      const second = await run();

      expect(counters(second)).toEqual({ total: 3, created: 0, updated: 0, skipped: 3, failed: 0 });
      expect(gateway.calls).toMatchObject({ find: 1, write: 1 });
      expect(sheet.calls.write).toBe(sheetWrites);
      expect(gateway.leads.size).toBe(3);
    });

    it('should link a row whose Lead ID cell was cleared back to its lead', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      await run();

      sheet.setCell(2, 'Lead ID Bitrix24', '');
      const second = await run();

      expect(counters(second)).toMatchObject({ created: 0, updated: 1 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe('1000');
    });
  });

  describe('TC3: trùng lặp', () => {
    it('should update the lead Bitrix24 already has for that email instead of creating one', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      const existing = gateway.seed({ email: emailOf(1), fields: { title: 'Nhập tay' } });

      const result = await run();

      expect(counters(result)).toMatchObject({ created: 0, updated: 1 });
      expect(gateway.leads.size).toBe(1);
      expect(gateway.leads.get(existing)?.fields.title).toBe('Khách 1 - ACME');
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe(String(existing));
    });

    it('should match by phone when the row has no email', async () => {
      const row = lead(1);
      row[1] = '';
      const { run, gateway } = harness([row]);
      const existing = gateway.seed({ phone: phoneOf(1) });

      await run();

      expect(gateway.leads.size).toBe(1);
      expect(gateway.leads.get(existing)?.fields.name).toBe('Khách 1');
    });

    it('should create one lead for two new rows with the same email and fail the lower row', async () => {
      const copy = lead(2);
      copy[1] = emailOf(1);
      const { run, sheet, gateway } = harness([lead(1), copy]);

      const result = await run();

      expect(result.status).toBe('partial');
      expect(counters(result)).toEqual({ total: 2, created: 1, updated: 0, skipped: 0, failed: 1 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(3, 'Trạng thái đồng bộ')).toBe('Lỗi');
      expect(sheet.cell(3, 'Thông báo lỗi')).toMatch(/^Trùng với hàng 2:/);
      expect(sheet.cell(3, 'Sync Hash')).toBe('');
    });

    it('should not rewrite a duplicate error the Sheet already shows, and heal when the upper row goes', async () => {
      const copy = lead(2);
      copy[1] = emailOf(1);
      const { run, sheet, gateway } = harness([lead(1), copy]);
      await run();
      const sheetWrites = sheet.calls.write;

      const second = await run();
      expect(second.failed).toBe(1);
      expect(sheet.calls.write).toBe(sheetWrites);

      sheet.grid[1] = [];
      const third = await run();
      expect(counters(third)).toMatchObject({ total: 1, updated: 1, failed: 0 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(3, 'Trạng thái đồng bộ')).toBe('Đã đồng bộ');
    });

    it('should fail the lower of two rows that Bitrix24 resolves to the same lead', async () => {
      const second = lead(2);
      const { run, sheet, gateway } = harness([lead(1), second]);
      gateway.seed({ email: emailOf(1), phone: phoneOf(2) });

      const result = await run();

      expect(counters(result)).toMatchObject({ created: 0, updated: 1, failed: 1 });
      expect(sheet.cell(3, 'Thông báo lỗi')).toMatch(/^Trùng với hàng 2:/);
      expect(gateway.leads.size).toBe(1);
    });
  });

  describe('TC4: lỗi API', () => {
    it('should search duplicates again and retry when the write batch fails temporarily', async () => {
      const { run, gateway } = harness(leads(2), { maxRetries: 2 });
      gateway.onWrite = (call) => (call <= 2 ? { error: timeout() } : undefined);

      const result = await run();

      expect(result.status).toBe('succeeded');
      expect(counters(result)).toMatchObject({ created: 2, failed: 0 });
      expect(gateway.calls).toMatchObject({ find: 3, write: 3 });
    });

    it('should not create duplicates when the write timed out after Bitrix24 executed it', async () => {
      const { run, sheet, gateway, items } = harness(leads(3));
      gateway.onWrite = (call) => (call === 1 ? { error: timeout(), applied: true } : undefined);

      const result = await run();

      expect(result.status).toBe('succeeded');
      expect(gateway.leads.size).toBe(3);
      // The second attempt found the leads the first one created, so it updated them.
      expect(counters(result)).toMatchObject({ created: 0, updated: 3, failed: 0 });
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe('1000');
      await expect(items.findByRun(result.id)).resolves.toMatchObject([
        { attempts: 2 },
        { attempts: 2 },
        { attempts: 2 },
      ]);
    });

    it('should fail only the batch that ran out of retries and keep going', async () => {
      const { run, sheet, gateway } = harness(leads(6), { batchSize: 2, maxRetries: 1 });
      gateway.onWrite = (_call, ops) =>
        ops.some((op) => op.row.rowNumber === 4) ? { error: timeout() } : undefined;

      const result = await run();

      expect(result.status).toBe('partial');
      expect(counters(result)).toEqual({ total: 6, created: 4, updated: 0, skipped: 0, failed: 2 });
      expect([2, 3, 6, 7].map((row) => sheet.cell(row, 'Trạng thái đồng bộ'))).toEqual(
        Array(4).fill('Đã đồng bộ'),
      );
      for (const row of [4, 5]) {
        expect(sheet.cell(row, 'Trạng thái đồng bộ')).toBe('Lỗi');
        expect(sheet.cell(row, 'Thông báo lỗi')).toMatch(
          /^Lỗi tạm thời, sẽ thử lại ở lần chạy sau:/,
        );
        expect(sheet.cell(row, 'Sync Hash')).toBe('');
      }

      gateway.onWrite = undefined;
      const next = await run();

      expect(next.status).toBe('succeeded');
      expect(counters(next)).toMatchObject({ created: 2, skipped: 4 });
      expect(sheet.cell(4, 'Thông báo lỗi')).toBe('');
      expect(gateway.leads.size).toBe(6);
    });

    it('should fail only the row Bitrix24 rejects and skip it until it is edited', async () => {
      const { run, sheet, gateway } = harness(leads(3));
      gateway.rejectRows.set(3, { code: 'INVALID_ARG_VALUE', message: 'Invalid value of stageId' });

      const result = await run();

      expect(counters(result)).toMatchObject({ created: 2, failed: 1 });
      expect(sheet.cell(3, 'Trạng thái đồng bộ')).toBe('Lỗi');
      expect(sheet.cell(3, 'Thông báo lỗi')).toBe(
        'Bitrix24 từ chối dữ liệu: Invalid value of stageId',
      );
      expect(sheet.cell(3, 'Sync Hash')).toMatch(/^invalid:[0-9a-f]{64}$/);

      const second = await run();
      expect(counters(second)).toMatchObject({ skipped: 3, failed: 0 });
      expect(gateway.calls.write).toBe(1);

      gateway.rejectRows.clear();
      sheet.setCell(3, 'Trạng thái', 'Đang liên hệ');
      const third = await run();
      expect(counters(third)).toMatchObject({ created: 1, skipped: 2 });
    });

    it('should cut a very long Bitrix24 error at 500 characters in the Sheet and in the log', async () => {
      const { run, sheet, gateway, items } = harness([lead(1)]);
      gateway.rejectRows.set(2, { code: 'E', message: `=${'x'.repeat(900)}` });

      const result = await run();

      expect(sheet.cell(2, 'Thông báo lỗi')).toHaveLength(500);
      const [item] = await items.findByRun(result.id, 'fail');
      expect(item.errorMessage).toHaveLength(500);
      expect(item.errorCode).toBe('E');
    });

    it('should report a row with bad data without sending it, and skip it while unchanged', async () => {
      const bad = lead(2);
      bad[1] = 'sai-email';
      bad[4] = 'nhiều';
      const { run, sheet, gateway } = harness([lead(1), bad]);

      const result = await run();

      expect(result.status).toBe('partial');
      expect(counters(result)).toEqual({ total: 2, created: 1, updated: 0, skipped: 0, failed: 1 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(3, 'Thông báo lỗi')).toBe(
        'Cột "Email": email sai định dạng, ví dụ đúng: ten@congty.vn; Cột "Ngân sách dự kiến": phải là số không âm, ví dụ 1500000, 1.500.000 hoặc 15tr',
      );
      expect(sheet.cell(3, 'Sync Hash')).toMatch(/^invalid:/);
      const sheetWrites = sheet.calls.write;

      const second = await run();
      expect(counters(second)).toMatchObject({ skipped: 2, failed: 0 });
      expect(sheet.calls.write).toBe(sheetWrites);

      sheet.setCell(3, 'Email', emailOf(2));
      sheet.setCell(3, 'Ngân sách dự kiến', '15tr');
      const third = await run();
      expect(counters(third)).toMatchObject({ created: 1, failed: 0 });
      expect(sheet.cell(3, 'Thông báo lỗi')).toBe('');
      expect(sheet.cell(3, 'Trạng thái đồng bộ')).toBe('Đã đồng bộ');
    });

    it('should fail a row whose Lead ID cell is not a number', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      await run();
      sheet.setCell(2, 'Lead ID Bitrix24', 'abc');

      const second = await run();

      expect(second.failed).toBe(1);
      expect(gateway.calls.write).toBe(1);
      expect(sheet.cell(2, 'Thông báo lỗi')).toMatch(/không phải số nguyên dương/);
    });

    it('should stop the run as failed on an access error, touching no row', async () => {
      const { run, sheet, gateway } = harness(leads(2));
      gateway.findError = new BitrixHttpError('Access denied', 'ACCESS_DENIED', 403);

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe('Access denied (ACCESS_DENIED)');
      expect(gateway.calls.write).toBe(0);
      expect(sheet.cell(2, 'Trạng thái đồng bộ')).toBe('');
    });

    it('should explain in Vietnamese that the portal plan blocks the REST API', async () => {
      const { run, gateway } = harness(leads(2));
      gateway.findError = new BitrixHttpError(
        'Feature is not available on the current plan.',
        'FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN',
        403,
      );

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe(
        'Gói dịch vụ của portal Bitrix24 không cho dùng REST API (FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN): bật dùng thử hoặc nâng gói của portal rồi chạy lại',
      );
    });

    it('should abort on OPERATION_TIME_LIMIT and mark the rows that are left as "Chờ xử lý"', async () => {
      const { run, sheet, gateway } = harness(leads(6), { batchSize: 2 });
      gateway.onWrite = (call) =>
        call === 2
          ? { error: new BitrixHttpError('Method is blocked', 'OPERATION_TIME_LIMIT', 503) }
          : undefined;

      const result = await run();

      expect(result.status).toBe('aborted');
      expect(result.stopReason).toMatch(/OPERATION_TIME_LIMIT/);
      expect(counters(result)).toMatchObject({ created: 2, failed: 0 });
      expect([2, 3].map((row) => sheet.cell(row, 'Trạng thái đồng bộ'))).toEqual([
        'Đã đồng bộ',
        'Đã đồng bộ',
      ]);
      expect([4, 5, 6, 7].map((row) => sheet.cell(row, 'Trạng thái đồng bộ'))).toEqual(
        Array(4).fill('Chờ xử lý'),
      );
      expect(gateway.calls.write).toBe(2);
    });

    it('should fail the run when the Sheet becomes unreadable', async () => {
      const { run, sheet } = harness([lead(1)]);
      sheet.beforeRead = () => {
        throw new SheetsError('Google từ chối truy cập', 'auth', 403);
      };

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe('Google từ chối truy cập');
    });
  });

  describe('edge cases of §14', () => {
    it('should recover on the next run when the lead was created but the Sheet write failed', async () => {
      const { run, sheet, gateway } = harness([lead(1)], { headers: [...BUSINESS, ...TECHNICAL] });
      sheet.failNextWrite = new SheetsError('Google Sheets gặp lỗi máy chủ', 'upstream', 503);

      const first = await run();

      expect(first.status).toBe('partial');
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe('');
      expect(sheet.cell(2, 'Thông báo lỗi')).toMatch(/^Lỗi tạm thời/);

      const second = await run();

      expect(counters(second)).toMatchObject({ created: 0, updated: 1, failed: 0 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.cell(2, 'Lead ID Bitrix24')).toBe('1000');
    });

    it('should not write results to rows the user moved during the run', async () => {
      const { run, sheet, gateway } = harness(leads(2), { headers: [...BUSINESS, ...TECHNICAL] });
      let reads = 0;
      sheet.beforeRead = () => {
        reads += 1;
        // Reads 1 and 2 load the sheet; read 3 is the check right before writing results.
        if (reads === 3) [sheet.grid[1], sheet.grid[2]] = [sheet.grid[2], sheet.grid[1]];
      };

      const first = await run();

      expect(first.status).toBe('partial');
      expect(counters(first)).toMatchObject({ created: 0, failed: 2 });
      expect(gateway.leads.size).toBe(2);
      expect([2, 3].map((row) => sheet.cell(row, 'Lead ID Bitrix24'))).toEqual(['', '']);

      sheet.beforeRead = undefined;
      const second = await run();

      expect(counters(second)).toMatchObject({ created: 0, updated: 2, failed: 0 });
      expect(gateway.leads.size).toBe(2);
      expect(sheet.cell(2, 'Email')).toBe(emailOf(2));
      expect(gateway.leads.get(Number(sheet.cell(2, 'Lead ID Bitrix24')))?.email).toBe(emailOf(2));
    });

    it('should finish the current batch and stop when the process is asked to shut down', async () => {
      const { run, runner, sheet, gateway } = harness(leads(4), { batchSize: 2 });
      gateway.onWrite = () => {
        void runner.beforeApplicationShutdown();
        return undefined;
      };

      const result = await run();

      expect(result.status).toBe('aborted');
      expect(result.stopReason).toMatch(/^Dừng theo yêu cầu tắt tiến trình/);
      expect(counters(result)).toMatchObject({ created: 2 });
      expect([4, 5].map((row) => sheet.cell(row, 'Trạng thái đồng bộ'))).toEqual([
        'Chờ xử lý',
        'Chờ xử lý',
      ]);
    });
  });

  describe('mapping', () => {
    it('should fail before touching the Sheet or Bitrix24 when the mapping does not fit', async () => {
      const mapping = parseMapping({
        version: 1,
        fields: [
          { column: 'Tên khách hàng', field: 'name', type: 'string', required: true },
          { column: 'Email', field: 'email', type: 'email' },
          { column: 'Số điện thoại', field: 'phone', type: 'phone' },
          { column: 'Cột không có', field: 'comments', type: 'string' },
          { column: 'Công ty', field: 'truongKhongCo', type: 'string' },
        ],
      });
      const { run, sheet, gateway } = harness([lead(1)], { mapping });

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe(
        'Mapping không hợp lệ: Sheet không có cột "Cột không có"; Bitrix24 không có trường lead "truongKhongCo"',
      );
      expect(sheet.calls.write).toBe(0);
      expect(sheet.grid[0]).toEqual(BUSINESS);
      expect(gateway.calls).toMatchObject({ find: 0, write: 0 });
    });

    it('should fail before touching the Sheet or Bitrix24 when the portal has leads turned off', async () => {
      const { run, sheet, gateway } = harness([lead(1)]);
      gateway.leadsEnabled = false;

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe(
        'Bitrix24 đang ở chế độ CRM đơn giản (không dùng Lead): lead mới sẽ bị tự chuyển thành Deal và Contact. Chuyển sang CRM cổ điển trong CRM > Cài đặt > Chế độ CRM rồi chạy lại',
      );
      expect(sheet.calls.write).toBe(0);
      expect(sheet.grid[0]).toEqual(BUSINESS);
      expect(gateway.calls).toMatchObject({ find: 0, write: 0 });
    });

    it('should refuse a dry run as well when the portal has leads turned off', async () => {
      const { run, gateway } = harness([lead(1)]);
      gateway.leadsEnabled = false;

      const result = await run({ dryRun: true });

      expect(result.status).toBe('failed');
      expect(result.stopReason).toMatch(/^Bitrix24 đang ở chế độ CRM đơn giản/);
    });

    it('should fail with a clear reason when the header row is empty', async () => {
      const { run } = harness([], { headers: [] });

      const result = await run();

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe(
        'Hàng tiêu đề (hàng 1) đang trống; kiểm tra sheet.headerRow trong mapping',
      );
    });

    it('should re-sync every row after the mapping changed', async () => {
      const first = harness(leads(2));
      await first.run();
      const changed = harness(first.sheet.grid.slice(1), {
        headers: first.sheet.grid[0] as string[],
        mapping: { ...MAPPING, defaults: { stageId: 'IN_PROCESS' } },
      });
      for (const [id, existing] of first.gateway.leads) changed.gateway.leads.set(id, existing);

      const result = await changed.run();

      expect(counters(result)).toMatchObject({ updated: 2, skipped: 0 });
    });
  });

  describe('dry run', () => {
    it('should plan everything but write nothing to Bitrix24, the Sheet or the item log', async () => {
      const bad = lead(3);
      bad[1] = 'sai';
      const { run, sheet, gateway, items } = harness([lead(1), lead(2), bad]);
      gateway.seed({ email: emailOf(2) });

      const result = await run({ dryRun: true });

      expect(result).toMatchObject({ status: 'partial', dryRun: true });
      expect(counters(result)).toEqual({ total: 3, created: 1, updated: 1, skipped: 0, failed: 1 });
      expect(gateway.calls).toMatchObject({ find: 1, write: 0 });
      expect(gateway.leads.size).toBe(1);
      expect(sheet.calls.write).toBe(0);
      expect(sheet.grid[0]).toEqual(BUSINESS);
      await expect(items.findByRun(result.id)).resolves.toEqual([]);
    });
  });

  describe('batching', () => {
    it.each([25, 26, 50])(
      'should sync %i new rows without exceeding 25 rows or 50 commands per call',
      async (count) => {
        const { run, sheet, gateway } = harness(leads(count));

        const result = await run();

        expect(counters(result)).toMatchObject({ total: count, created: count, failed: 0 });
        expect(gateway.calls.write).toBe(Math.ceil(count / 25));
        expect(Math.max(...gateway.writeSizes)).toBeLessThanOrEqual(25);
        expect(Math.max(...gateway.findSizes)).toBeLessThanOrEqual(50);
        expect(gateway.leads.size).toBe(count);
        for (let row = 2; row <= count + 1; row++) {
          expect(sheet.cell(row, 'Lead ID Bitrix24')).not.toBe('');
        }
      },
    );
  });

  describe('performance: 150 rows', () => {
    it('should make exactly 2 + 2 × batches Bitrix24 calls and 3 + batches Sheet reads', async () => {
      const { run, sheet, gateway } = harness(leads(150));
      const batches = 150 / 25;
      const startedAt = Date.now();

      const result = await run();

      expect(result.status).toBe('succeeded');
      expect(counters(result)).toEqual({
        total: 150,
        created: 150,
        updated: 0,
        skipped: 0,
        failed: 0,
      });
      // Bitrix24: one crm.settings.mode.get and one crm.item.fields, then one duplicate search
      // and one write per batch.
      expect(gateway.calls).toEqual({
        mode: 1,
        fields: 1,
        find: batches,
        get: 0,
        write: batches,
      });
      expect(gateway.findSizes).toEqual(Array(batches).fill(50));
      expect(gateway.writeSizes).toEqual(Array(batches).fill(25));
      // Google: metadata + two renderings, then one key-column check per batch.
      expect(sheet.calls.read).toBe(3 + batches);
      // Google: hide columns + header row (first run only), then one result write per batch.
      expect(sheet.calls.write).toBe(2 + batches);
      expect(Date.now() - startedAt).toBeLessThan(5000);
    });

    it('should make two Bitrix24 calls and three Sheet reads when nothing changed', async () => {
      const { run, sheet, gateway } = harness(leads(150));
      await run();
      gateway.calls = { mode: 0, fields: 0, find: 0, get: 0, write: 0 };
      sheet.calls = { read: 0, write: 0 };

      const result = await run();

      expect(counters(result)).toMatchObject({ skipped: 150, failed: 0 });
      expect(gateway.calls).toEqual({ mode: 1, fields: 1, find: 0, get: 0, write: 0 });
      expect(sheet.calls).toEqual({ read: 3, write: 0 });
    });
  });

  describe('lock and lifecycle', () => {
    it('should refuse a second run while one is in progress, naming it', async () => {
      const { runner, gateway } = harness(leads(2));
      let release: () => void = () => undefined;
      gateway.gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const first = await runner.start({ trigger: 'schedule' });
      const second = runner.start({ trigger: 'http' });

      await expect(second).rejects.toBeInstanceOf(LeadSyncBusyError);
      await expect(second).rejects.toMatchObject({ runId: first.run.id });
      release();
      await expect(first.done).resolves.toMatchObject({ status: 'succeeded', trigger: 'schedule' });

      const third = await runner.start({ trigger: 'http' });
      await expect(third.done).resolves.toMatchObject({ status: 'succeeded' });
    });

    it('should resolve done, never reject, when the run cannot be closed in the database', async () => {
      const { runner, runs } = harness(leads(1));
      jest.spyOn(runs, 'finish').mockRejectedValue(new Error('disk I/O error'));

      const { run, done } = await runner.start({ trigger: 'http' });

      await expect(done).resolves.toMatchObject({
        id: run.id,
        status: 'failed',
        created: 1,
        stopReason: 'disk I/O error',
      });
    });

    it('should take over a run that died without releasing the lock', async () => {
      const { run, runs } = harness([lead(1)]);
      const dead = await runs.acquire('schedule', false, 120_000);
      await dataSource
        .getRepository(LeadSyncRun)
        .update({ id: dead?.id }, { heartbeatAt: Date.now() - 121_000 });

      const result = await run();

      expect(result.status).toBe('succeeded');
      await expect(runs.findById(dead?.id ?? '')).resolves.toMatchObject({ status: 'aborted' });
    });

    it('should refuse to start, creating no run, when the integration is not configured', async () => {
      const { runner, readiness, runs } = harness([lead(1)]);
      readiness.missing.mockResolvedValue('Chưa cấu hình GOOGLE_SHEET_ID');

      await expect(runner.start({ trigger: 'http' })).rejects.toThrow(
        new LeadSyncConfigError('Chưa cấu hình GOOGLE_SHEET_ID'),
      );
      await expect(runs.findLatest()).resolves.toBeNull();
    });

    it('should delete runs older than the retention period, with their items', async () => {
      const { run, runs, items } = harness([lead(1)]);
      const old = await run();
      await dataSource
        .getRepository(LeadSyncRun)
        .update({ id: old.id }, { startedAt: new Date(Date.now() - 31 * 86_400_000) });

      const next = await run();

      await expect(runs.findById(old.id)).resolves.toBeNull();
      await expect(items.findByRun(old.id)).resolves.toEqual([]);
      await expect(runs.findById(next.id)).resolves.not.toBeNull();
    });
  });

  describe('logging', () => {
    it('should log a summary line and never a customer name, email or phone', async () => {
      const lines: string[] = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          lines.push(String(args[0]));
        });
      }
      const bad = lead(2);
      bad[1] = 'sai-email';
      const { run, gateway } = harness([lead(1), bad, lead(3)]);
      gateway.rejectRows.set(4, { code: 'INVALID_ARG_VALUE', message: 'Invalid value' });

      const result = await run();

      expect(lines).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^Lead sync ${result.id} finished: total=3 created=1 updated=0 skipped=0 failed=2 duration=\\d+\\.\\ds$`,
          ),
        ),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/row 3 failed at validate: code=VALIDATION message=Cột "Email"/),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/row 4 failed at write: code=INVALID_ARG_VALUE/),
      );
      const all = lines.join('\n');
      for (const secret of ['Khách 1', emailOf(1), phoneOf(1), '0900000001', 'sai-email']) {
        expect(all).not.toContain(secret);
      }
    });
  });
});
