import { OperationEntity } from '../entities/operation.entity.js';
import { RecoverySweeperService } from '../services/recovery-sweeper.service.js';

function operation(id: string, kind: string, attempt = 1) {
  return {
    id,
    kind,
    attempt,
    status: 'processing',
    leaseToken: 'lease',
    leaseUntil: new Date(0),
    nextAttemptAt: null,
    lastErrorCode: null,
    save: undefined,
  } as never;
}

describe('RecoverySweeperService', () => {
  it('replays expired safe leases, reconciles unsafe work, and redispatches stale waiting operations', async () => {
    const safe = operation('safe', 'tiktok_ingest');
    const unsafe = operation('unsafe', 'bitrix_deal_convert', 1);
    const waitingRows = [
      { id: 'ready', kind: 'integration_report', nextAttemptAt: null },
      { id: 'unpublished', kind: 'integration_report', nextAttemptAt: null },
      { id: 'recent', kind: 'integration_report', nextAttemptAt: null },
      { id: 'future', kind: 'integration_report', nextAttemptAt: new Date('2026-02-02T00:00:00Z') },
    ];
    let queryCount = 0;
    const builders = [[safe, unsafe], waitingRows].map((rows) => ({
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => rows),
    }));
    const operationRepo = {
      createQueryBuilder: jest.fn(() => builders[queryCount++]),
      save: jest.fn(() => undefined),
    };
    const outboxes = new Map<string, any>([
      ['unpublished', { publishedAt: null, createdAt: new Date(0) }],
      ['recent', { publishedAt: new Date(0), createdAt: new Date('2026-01-31T23:59:30Z') }],
      ['future', null],
    ]);
    const outboxRepo = {
      findOne: jest.fn(({ where }) => outboxes.get(where.operationId) ?? null),
    };
    const manager = {
      getRepository: (entity: unknown) => (entity === OperationEntity ? operationRepo : outboxRepo),
    };
    const dataSource = {
      transaction: jest.fn((work: (tx: typeof manager) => unknown) => work(manager)),
    };
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new RecoverySweeperService(dataSource as never, outbox as never, 60_000, 5);
    const result = await service.sweep(10, new Date('2026-02-01T00:00:00Z'));
    expect(result).toEqual({ redispatched: 2, reconciled: 1 });
    expect(safe).toMatchObject({
      status: 'pending',
      leaseToken: null,
      lastErrorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(unsafe).toMatchObject({ status: 'reconcile_required', leaseUntil: null });
    expect(outbox.append).toHaveBeenCalledTimes(2);
    expect(outboxRepo.findOne).toHaveBeenCalledTimes(4);
    expect(operationRepo.save).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid batch limits and respects retry limits for expired work', async () => {
    const tooManyAttempts = operation('exhausted', 'tiktok_ingest', 6);
    let queryCount = 0;
    const builders = [[tooManyAttempts], []].map((rows) => ({
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => rows),
    }));
    const repository = {
      createQueryBuilder: jest.fn(() => builders[queryCount++]),
      save: jest.fn(),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === OperationEntity ? repository : { findOne: jest.fn() },
    };
    const service = new RecoverySweeperService(
      { transaction: (work: (tx: typeof manager) => unknown) => work(manager) } as never,
      { append: jest.fn() } as never,
    );
    await expect(service.sweep(0)).rejects.toThrow(RangeError);
    await expect(service.sweep(1)).resolves.toEqual({ redispatched: 0, reconciled: 1 });
    expect(tooManyAttempts).toMatchObject({ status: 'reconcile_required' });
  });
});
