import { DataSource } from 'typeorm';

import { LeadSyncRunItem } from '../entities/lead-sync-run-item.entity.js';
import { LeadSyncRun } from '../entities/lead-sync-run.entity.js';
import { LeadSyncRunItemRepository } from '../repositories/lead-sync-run-item.repository.js';
import { LeadSyncRunRepository } from '../repositories/lead-sync-run.repository.js';

const STALE_MS = 120_000;
const DAY_MS = 86_400_000;
const counters = { total: 5, created: 2, updated: 1, skipped: 1, failed: 1 };

/** Runs against a real in-memory SQLite database: the lock is an SQL-level guarantee. */
describe('LeadSyncRunRepository', () => {
  let dataSource: DataSource;
  let runs: LeadSyncRunRepository;
  let items: LeadSyncRunItemRepository;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [LeadSyncRun, LeadSyncRunItem],
      synchronize: true,
    });
    await dataSource.initialize();
    runs = new LeadSyncRunRepository(dataSource);
    items = new LeadSyncRunItemRepository(dataSource);
  });

  afterEach(async () => dataSource.destroy());

  it('should start a run as "running" with zeroed counters', async () => {
    const run = await runs.acquire('cli', true, STALE_MS);

    expect(run).toMatchObject({
      trigger: 'cli',
      status: 'running',
      dryRun: true,
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      stopReason: null,
      finishedAt: null,
    });
    expect(run?.startedAt).toBeInstanceOf(Date);
  });

  it('should give the lock to only one of two callers', async () => {
    const first = await runs.acquire('schedule', false, STALE_MS);
    const second = await runs.acquire('http', false, STALE_MS);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await expect(runs.findRunning()).resolves.toMatchObject({ id: first?.id });
  });

  it('should give the lock to only one of several concurrent callers', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => runs.acquire('http', false, STALE_MS)),
    );

    expect(results.filter((run) => run !== null)).toHaveLength(1);
  });

  it('should free the lock when the run finishes', async () => {
    const first = await runs.acquire('cli', false, STALE_MS);
    const finished = await runs.finish(first?.id ?? '', 'partial', counters, null);

    expect(finished).toMatchObject({ status: 'partial', ...counters });
    expect(finished.finishedAt).toBeInstanceOf(Date);
    await expect(runs.findRunning()).resolves.toBeNull();
    await expect(runs.acquire('cli', false, STALE_MS)).resolves.not.toBeNull();
  });

  it('should take over a run whose heartbeat is older than the lease and mark it aborted', async () => {
    const dead = await runs.acquire('schedule', false, STALE_MS);
    await dataSource
      .getRepository(LeadSyncRun)
      .update({ id: dead?.id }, { heartbeatAt: Date.now() - STALE_MS - 1 });

    const next = await runs.acquire('cli', false, STALE_MS);

    expect(next).not.toBeNull();
    await expect(runs.findById(dead?.id ?? '')).resolves.toMatchObject({
      status: 'aborted',
      stopReason: 'Lần chạy không còn phản hồi và đã bị lần chạy sau tiếp quản',
    });
  });

  it('should not let a run that was taken over overwrite its "aborted" status when it ends', async () => {
    const stale = await runs.acquire('schedule', false, STALE_MS);
    await dataSource
      .getRepository(LeadSyncRun)
      .update({ id: stale?.id }, { heartbeatAt: Date.now() - STALE_MS - 1 });
    await runs.acquire('http', false, STALE_MS);

    const closed = await runs.finish(
      stale?.id ?? '',
      'succeeded',
      { total: 9, created: 9, updated: 0, skipped: 0, failed: 0 },
      null,
    );

    expect(closed.status).toBe('aborted');
    expect(closed.stopReason).toBe('Lần chạy không còn phản hồi và đã bị lần chạy sau tiếp quản');
  });

  it('should keep a slow but alive run locked while it sends heartbeats', async () => {
    const run = await runs.acquire('schedule', false, STALE_MS);
    await dataSource.getRepository(LeadSyncRun).update({ id: run?.id }, { heartbeatAt: 1 });

    await runs.heartbeat(run?.id ?? '', counters);

    await expect(runs.acquire('cli', false, STALE_MS)).resolves.toBeNull();
    await expect(runs.findById(run?.id ?? '')).resolves.toMatchObject(counters);

    await dataSource.getRepository(LeadSyncRun).update({ id: run?.id }, { heartbeatAt: 1 });
    await runs.touch(run?.id ?? '');
    await expect(runs.acquire('cli', false, STALE_MS)).resolves.toBeNull();
  });

  it('should cut a long stop reason at 500 characters', async () => {
    const run = await runs.acquire('cli', false, STALE_MS);

    const finished = await runs.finish(run?.id ?? '', 'failed', counters, 'x'.repeat(900));

    expect(finished.stopReason).toHaveLength(500);
  });

  it('should list runs newest first, page by page, and find the latest', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const run = await runs.acquire('cli', false, STALE_MS);
      await dataSource
        .getRepository(LeadSyncRun)
        .update({ id: run?.id }, { startedAt: new Date(Date.UTC(2026, 9, 1 + index)) });
      await runs.finish(run?.id ?? '', 'succeeded', counters, null);
      ids.push(run?.id ?? '');
    }

    const [firstPage, total] = await runs.list(1, 2);
    const [secondPage] = await runs.list(2, 2);

    expect(total).toBe(3);
    expect(firstPage.map((run) => run.id)).toEqual([ids[2], ids[1]]);
    expect(secondPage.map((run) => run.id)).toEqual([ids[0]]);
    await expect(runs.findLatest()).resolves.toMatchObject({ id: ids[2] });
  });

  it('should find finished runs older than the retention period, never the running one', async () => {
    const old = await runs.acquire('cli', false, STALE_MS);
    await runs.finish(old?.id ?? '', 'succeeded', counters, null);
    const recent = await runs.acquire('cli', false, STALE_MS);
    await runs.finish(recent?.id ?? '', 'succeeded', counters, null);
    const running = await runs.acquire('cli', false, STALE_MS);
    const longAgo = new Date(Date.now() - 31 * DAY_MS);
    await dataSource
      .getRepository(LeadSyncRun)
      .update([old?.id ?? '', running?.id ?? ''], { startedAt: longAgo });

    await expect(runs.findExpiredIds(30)).resolves.toEqual([old?.id]);
  });

  it('should store, read and delete the items of a run', async () => {
    const run = await runs.acquire('cli', false, STALE_MS);
    const runId = run?.id ?? '';
    await items.addMany(runId, [
      { rowNumber: 5, action: 'fail', errorCode: 'VALIDATION', errorMessage: 'y'.repeat(900) },
      { rowNumber: 2, action: 'create', leadId: 912, attempts: 2 },
    ]);
    await items.addMany(runId, []);

    const all = await items.findByRun(runId);
    expect(all.map((item) => item.rowNumber)).toEqual([2, 5]);
    expect(all[0]).toMatchObject({ action: 'create', leadId: '912', attempts: 2, errorCode: null });
    expect(all[1]).toMatchObject({ action: 'fail', leadId: null, attempts: 1 });
    expect(all[1].errorMessage).toHaveLength(500);
    await expect(items.findByRun(runId, 'fail')).resolves.toHaveLength(1);

    await items.deleteByRunIds([runId]);
    await runs.deleteByIds([runId]);
    await expect(items.findByRun(runId)).resolves.toEqual([]);
    await expect(runs.findById(runId)).resolves.toBeNull();
  });

  it('should insert a few hundred items in one call', async () => {
    const run = await runs.acquire('cli', false, STALE_MS);
    const many = Array.from({ length: 350 }, (_unused, index) => ({
      rowNumber: index + 2,
      action: 'fail' as const,
      errorCode: 'VALIDATION',
    }));

    await items.addMany(run?.id ?? '', many);

    await expect(items.findByRun(run?.id ?? '')).resolves.toHaveLength(350);
  });
});
