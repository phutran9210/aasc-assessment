import { TiktokHealthService } from '../health/health.service.js';

function makeHealth(
  overrides: {
    dbFail?: boolean;
    migrations?: boolean;
    redisFail?: boolean;
    workerRequired?: boolean;
    beat?: number | null;
  } = {},
) {
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({
      oldestPending: new Date('2026-01-01T00:00:00Z'),
      deadLetters: '2',
      reconcileRequired: '1',
      retryWaiting: '3',
    }),
  };
  const manager = {
    query: jest.fn(),
    getRepository: jest.fn(() => ({ createQueryBuilder: () => queryBuilder })),
  };
  const dataSource = {
    transaction: overrides.dbFail
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn((work) => work(manager)),
    showMigrations: jest.fn().mockResolvedValue(overrides.migrations ?? false),
  };
  const client = {
    ping: overrides.redisFail
      ? jest.fn().mockRejectedValue(new Error('redis down'))
      : jest.fn().mockResolvedValue('PONG'),
  };
  const redis = {
    shared: overrides.redisFail
      ? jest.fn().mockRejectedValue(new Error('redis down'))
      : jest.fn().mockResolvedValue(client),
  };
  const heartbeat = {
    latestBeatAt: jest
      .fn()
      .mockResolvedValue(overrides.beat === undefined ? 1_800_000_000_000 : overrides.beat),
  };
  const metrics = { record: jest.fn() };
  const service = new TiktokHealthService(
    dataSource as never,
    redis as never,
    heartbeat as never,
    metrics,
    { tiktokMode: 'mock', bitrixMode: 'mock', workerRequired: overrides.workerRequired ?? false },
    () => 1_800_000_000_000,
  );
  return { service, dataSource, heartbeat, metrics };
}

describe('TiktokHealthService', () => {
  it('reports a healthy database, schema, Redis and optional worker', async () => {
    const { service, metrics } = makeHealth();
    expect(service.live()).toEqual({ status: 'ok' });
    const result = await service.ready();
    expect(result).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', schema: 'ok', redis: 'ok', config: 'ok', worker: 'not_required' },
      metrics: { deadLetters: 2, retryWaiting: 3 },
    });
    expect(metrics.record).toHaveBeenCalledTimes(4);
  });

  it('caches a passing schema check and marks a stale worker beat', async () => {
    const { service, dataSource, heartbeat } = makeHealth({ workerRequired: true, beat: 1 });
    expect((await service.ready()).checks.worker).toBe('stale');
    await service.ready();
    expect(dataSource.showMigrations).toHaveBeenCalledTimes(1);
    expect(heartbeat.latestBeatAt).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable database, pending schema, Redis and worker dependencies', async () => {
    const { service: downDb } = makeHealth({ dbFail: true, workerRequired: true });
    expect(await downDb.ready()).toMatchObject({
      status: 'unavailable',
      checks: { database: 'down', worker: 'ok' },
      metrics: null,
    });
    const { service: pendingSchema } = makeHealth({ migrations: true });
    expect((await pendingSchema.ready()).checks.schema).toBe('down');
    const { service: downRedis } = makeHealth({ redisFail: true, workerRequired: true });
    expect(await downRedis.ready()).toMatchObject({
      status: 'unavailable',
      checks: { redis: 'down', worker: 'down' },
    });
    const { service: absentBeat } = makeHealth({ workerRequired: true, beat: null });
    expect((await absentBeat.ready()).checks.worker).toBe('down');
  });
});
