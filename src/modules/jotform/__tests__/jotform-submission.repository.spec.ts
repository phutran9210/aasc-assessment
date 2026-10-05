import { DataSource } from 'typeorm';

import { JotformSubmission } from '../entities/jotform-submission.entity.js';
import { JotformSubmissionRepository } from '../repositories/jotform-submission.repository.js';

const STALE_MS = 120_000;

/** Runs against a real in-memory SQLite database: the guarantees here are SQL-level. */
describe('JotformSubmissionRepository', () => {
  let dataSource: DataSource;
  let repository: JotformSubmissionRepository;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [JotformSubmission],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = new JotformSubmissionRepository(dataSource);
  });

  afterEach(async () => dataSource.destroy());

  it('should claim a new submission and store it as PROCESSING', async () => {
    const { outcome, record } = await repository.claim('6001', '77', STALE_MS);

    expect(outcome).toBe('claimed');
    expect(record).toMatchObject({ submissionId: '6001', formId: '77', status: 'PROCESSING' });
    expect(record.id).toEqual(expect.any(String));
  });

  it('should report "busy" to a second caller while the first is still processing', async () => {
    await repository.claim('6001', '77', STALE_MS);

    await expect(repository.claim('6001', '77', STALE_MS)).resolves.toMatchObject({
      outcome: 'busy',
    });
  });

  it('should let exactly one of many concurrent callers claim a submission', async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claim('6001', '77', STALE_MS)),
    );

    expect(claims.filter((claim) => claim.outcome === 'claimed')).toHaveLength(1);
    expect(await dataSource.getRepository(JotformSubmission).count()).toBe(1);
  });

  it('should report "synced" with the contact id once the contact exists', async () => {
    const { record } = await repository.claim('6001', '77', STALE_MS);
    await repository.markSynced(record.id, '42');

    const again = await repository.claim('6001', '77', STALE_MS);

    expect(again.outcome).toBe('synced');
    expect(again.record).toMatchObject({ status: 'SYNCED', bitrixContactId: '42', error: null });
    expect(again.record.syncedAt).toBeInstanceOf(Date);
  });

  it.each(['FAILED', 'INVALID'] as const)(
    'should allow a %s submission to be claimed again',
    async (status) => {
      const { record } = await repository.claim('6001', '77', STALE_MS);
      await repository.markFailed(record.id, status, 'x'.repeat(900));

      const stored = await dataSource.getRepository(JotformSubmission).findOneByOrFail({
        id: record.id,
      });
      expect(stored.status).toBe(status);
      expect(stored.error).toHaveLength(500);

      const retry = await repository.claim('6001', '77', STALE_MS);
      expect(retry.outcome).toBe('claimed');
      expect(retry.record).toMatchObject({ id: record.id, status: 'PROCESSING', error: null });
    },
  );

  it('should take over a PROCESSING row whose owner stopped responding', async () => {
    await repository.claim('6001', '77', STALE_MS);

    // staleMs = -1 makes the existing claim look expired.
    await expect(repository.claim('6001', '77', -1)).resolves.toMatchObject({
      outcome: 'claimed',
    });
  });
});
