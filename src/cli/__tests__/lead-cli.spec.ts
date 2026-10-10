import { NestFactory } from '@nestjs/core';
import { appConfig } from '@config/index.js';
import { runLeadSyncCli } from '../lead-sync.js';
import { runLeadSheetSeedCli } from '../lead-sheet-seed.js';

describe('lead CLI entrypoints', () => {
  const oldExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = oldExitCode;
    jest.restoreAllMocks();
  });

  it('rejects invalid lead-sync arguments before creating an application', async () => {
    const create = jest.spyOn(NestFactory, 'createApplicationContext');
    await expect(runLeadSyncCli(['--unknown'])).rejects.toThrow('Tham số không hợp lệ');
    expect(create).not.toHaveBeenCalled();
  });

  it('runs lead sync, prints completion details and closes the application context', async () => {
    const run = { id: 'run-1' };
    const runner = {
      start: jest.fn().mockResolvedValue({
        run,
        done: Promise.resolve({
          status: 'failed',
          total: 2,
          created: 0,
          updated: 1,
          skipped: 0,
          failed: 1,
          stopReason: 'provider',
        }),
      }),
    };
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn(() => runner),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(NestFactory, 'createApplicationContext').mockResolvedValue(app as never);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const table = jest.spyOn(console, 'table').mockImplementation(() => undefined);
    await runLeadSyncCli(['--dry-run', '--force']);
    expect(runner.start).toHaveBeenCalledWith({ trigger: 'cli', dryRun: true, force: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dry run'));
    expect(table).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', total: 2 }));
    expect(app.close).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid seed arguments before creating an application', async () => {
    const create = jest.spyOn(NestFactory, 'createApplicationContext');
    await expect(runLeadSheetSeedCli(['--clear', '2'])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('seeds and clears rows, and closes the context after failures or production guard', async () => {
    const seeder = {
      seed: jest.fn().mockResolvedValue({ added: 2, firstRow: 3, lastRow: 4 }),
      clear: jest.fn().mockResolvedValue({ rows: 2, leads: 1 }),
    };
    const app = {
      get: jest.fn((token: unknown) =>
        token === appConfig.KEY ? { isProduction: false } : seeder,
      ),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(NestFactory, 'createApplicationContext').mockResolvedValue(app as never);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await runLeadSheetSeedCli(['2']);
    expect(seeder.seed).toHaveBeenCalledWith(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Đã thêm 2 hàng'));
    await runLeadSheetSeedCli(['--clear']);
    expect(seeder.clear).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Đã xóa 2 hàng'));
    seeder.seed.mockRejectedValueOnce(new Error('sheet failed'));
    await expect(runLeadSheetSeedCli(['1'])).rejects.toThrow('sheet failed');
    expect(app.close).toHaveBeenCalledTimes(3);

    app.get.mockImplementation((token: unknown) =>
      token === appConfig.KEY ? { isProduction: true } : seeder,
    );
    await expect(runLeadSheetSeedCli([])).rejects.toThrow('NODE_ENV=production');
    expect(app.close).toHaveBeenCalledTimes(4);
    expect(seeder).toBeDefined();
  });
});
